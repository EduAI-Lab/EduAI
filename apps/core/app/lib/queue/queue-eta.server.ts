import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { workerConcurrency } from "./concurrency.server";
import { QUEUE_CHAT, QUEUE_HEAVY } from "./resolve-pool.server";

/** Number of recent completions used to estimate a pool's service time. */
export const ETA_SAMPLE_SIZE = 20;

type EtaJobInput = {
  queueName?: string | null;
  status: string;
};

type DurationRow = {
  startedAt: Date | null;
  completedAt: Date | null;
};

type EtaClient = Pick<Prisma.TransactionClient, "aiJob">;

function meanDurationMs(rows: readonly DurationRow[]): number | null {
  const durations = rows.flatMap(({ startedAt, completedAt }) => {
    if (!startedAt || !completedAt) return [];
    const durationMs = completedAt.getTime() - startedAt.getTime();
    return durationMs > 0 ? [durationMs] : [];
  });

  if (durations.length === 0) return null;
  return (
    durations.reduce((sum, duration) => sum + duration, 0) / durations.length
  );
}

/**
 * Estimate the remaining wait in seconds from the queue position and the
 * recent service time of the same persisted pool. This intentionally returns
 * null until the pool has usable observations instead of inventing an ETA.
 */
export async function getQueueEtaSeconds(
  job: EtaJobInput,
  queuePosition: number | null,
  { client = prisma }: { client?: EtaClient } = {},
): Promise<number | null> {
  if (job.status !== "PENDING" || queuePosition === null || queuePosition < 1) {
    return null;
  }
  if (!job.queueName) return null;

  try {
    const rows = await client.aiJob.findMany({
      where: {
        queueName: job.queueName,
        status: "COMPLETED",
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true },
      orderBy: { completedAt: "desc" },
      take: ETA_SAMPLE_SIZE,
    });
    const durationMs = meanDurationMs(rows);
    if (durationMs === null) return null;

    if (job.queueName !== QUEUE_CHAT && job.queueName !== QUEUE_HEAVY)
      return null;
    const concurrency = workerConcurrency(job.queueName);
    return Math.ceil((queuePosition * durationMs) / (concurrency * 1000));
  } catch (error) {
    // ETA is advisory. A stats read must not make an otherwise valid status
    // response fail when the aggregation query is temporarily unavailable.
    console.error("[ai-job-queue] ETA lookup failed:", error);
    return null;
  }
}
