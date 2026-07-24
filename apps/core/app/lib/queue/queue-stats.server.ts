import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { JobTypeSchema, type JobType } from "./job-schema";
import { priorityFor, resolveQueueName, type QueueName } from "./resolve-pool.server";

/**
 * Live queue depth/position reads + backpressure policy (issue #915, contract §8).
 *
 * All reads are computed against the durable `ai_jobs` rows (source of truth),
 * never against Redis — a Redis flush must not change what the client sees.
 * Queue membership comes from the persisted `AiJob.queueName` (written at
 * enqueue time), not from re-resolving `type`, so a `VLLM_FLEET_HEAVY_URL` flip
 * can't retroactively move already-queued jobs between queues in these reads.
 * Rows with a null `queueName` never reached a queue and are counted by none.
 */

const ALL_JOB_TYPES: readonly JobType[] = JobTypeSchema.options;

/** Default `Retry-After` seconds suggested to callers on queue-full rejection. */
export const QUEUE_FULL_RETRY_AFTER_SECONDS = 30;

/**
 * How long a PENDING row with no `bullJobId` still counts as queued. Rows past
 * this age never made it into Redis (the BullMQ add failed and no reaper has
 * shipped) — excluding them keeps orphans from permanently consuming
 * `QUEUE_MAX_DEPTH` capacity and wedging the endpoint into 429s.
 */
export const PENDING_WITHOUT_BULL_GRACE_MS = 5 * 60 * 1000;

/**
 * Rows that are plausibly in Redis: `bullJobId` persisted, or still inside the
 * short window where a healthy enqueue hasn't written it back yet.
 */
function inTransportFilter(): Prisma.AiJobWhereInput {
  return {
    OR: [
      { bullJobId: { not: null } },
      { createdAt: { gt: new Date(Date.now() - PENDING_WITHOUT_BULL_GRACE_MS) } },
    ],
  };
}

/**
 * Max PENDING jobs per queue before `enqueue()` rejects with `QueueFullError`.
 * Read from `QUEUE_MAX_DEPTH`; unset, `0`, or anything but a plain positive
 * integer disables backpressure (default) — mirrors the off-by-default
 * `QUEUE_ENQUEUE_ENABLED` ethos. Strict digits-only parsing: `"1e3"`/`"10k"`
 * disable the cap instead of silently truncating to `1`/`10`.
 */
export function maxQueueDepth(): number | null {
  const raw = process.env.QUEUE_MAX_DEPTH?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return parsed > 0 ? parsed : null;
}

/** Thrown by `enqueue()` when the target queue is saturated; routes map it to 429. */
export class QueueFullError extends Error {
  readonly queueName: QueueName;
  readonly depth: number;
  readonly maxDepth: number;
  readonly retryAfterSeconds: number;

  constructor(queueName: QueueName, depth: number, maxDepth: number) {
    super(`Queue ${queueName} is full (${depth}/${maxDepth} pending jobs)`);
    this.name = "QueueFullError";
    this.queueName = queueName;
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.retryAfterSeconds = QUEUE_FULL_RETRY_AFTER_SECONDS;
  }
}

/** Live depth of `queueName`: count of PENDING rows pushed onto that queue. */
export async function getQueueDepth(queueName: QueueName): Promise<number> {
  return prisma.aiJob.count({
    where: { status: "PENDING", queueName, ...inTransportFilter() },
  });
}

/**
 * Live 1-based position of a job in its queue, or `null` when the job is no
 * longer PENDING (position is meaningless once it runs or finishes).
 *
 * "Ahead" means it drains first under the producer's ordering (contract §4):
 * a stronger (numerically lower) BullMQ priority, or the same priority with an
 * earlier `createdAt` (ties broken by `id` so two same-millisecond jobs never
 * report the same position). Position 1 = next up.
 *
 * Priority is derived from `type` — the same input the producer passed to
 * `priorityFor()` — while queue membership comes from the row's persisted
 * `queueName` (falling back to the current mapping for a row that predates it).
 */
export async function getQueuePosition(job: {
  id: string;
  type: JobType;
  status: string;
  createdAt: Date;
  queueName?: string | null;
}): Promise<number | null> {
  if (job.status !== "PENDING") return null;

  const queueName = job.queueName ?? resolveQueueName(job.type);
  const priority = priorityFor(job.type);
  const strongerTypes = ALL_JOB_TYPES.filter((type) => priorityFor(type) < priority);
  const samePriorityTypes = ALL_JOB_TYPES.filter((type) => priorityFor(type) === priority);

  const ahead = await prisma.aiJob.count({
    where: {
      status: "PENDING",
      queueName,
      id: { not: job.id },
      AND: [
        inTransportFilter(),
        {
          OR: [
            ...(strongerTypes.length > 0 ? [{ type: { in: [...strongerTypes] } }] : []),
            {
              type: { in: [...samePriorityTypes] },
              OR: [
                { createdAt: { lt: job.createdAt } },
                { createdAt: job.createdAt, id: { lt: job.id } },
              ],
            },
          ],
        },
      ],
    },
  });
  return ahead + 1;
}
