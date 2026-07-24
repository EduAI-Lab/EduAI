import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { JobTypeSchema, type JobType } from "./job-schema";
import { priorityFor, resolveQueueName, type QueueName } from "./resolve-pool.server";

/**
 * Live queue depth/position reads + backpressure policy (issue #915, contract §8).
 *
 * All reads are computed against the durable `ai_jobs` rows (source of truth),
 * never against Redis — a Redis flush must not change what the client sees.
 * A queue's population is derived from `AiJob.type` through the same
 * `resolveQueueName()` mapping the producer uses. Known limitation: that
 * mapping is re-resolved per read, so jobs physically added to a BullMQ queue
 * before a `VLLM_FLEET_HEAVY_URL` flip stay in the old Redis queue while these
 * reads attribute them to the new one — the snapshot can disagree with the
 * transport until those jobs drain (goes away with #168 fleet routing).
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

/** Job types that currently resolve to `queueName` (heavy pool may be off). */
export function typesForQueue(queueName: QueueName): JobType[] {
  return ALL_JOB_TYPES.filter((type) => resolveQueueName(type) === queueName);
}

/** Live depth of `queueName`: count of PENDING rows whose type resolves to it. */
export async function getQueueDepth(queueName: QueueName): Promise<number> {
  const types = typesForQueue(queueName);
  if (types.length === 0) return 0;
  return prisma.aiJob.count({
    where: { status: "PENDING", type: { in: types }, ...inTransportFilter() },
  });
}

/**
 * Live 1-based position of a job in its resolved queue, or `null` when the job
 * is no longer PENDING (position is meaningless once it runs or finishes).
 *
 * "Ahead" means it drains first under the producer's ordering (contract §4):
 * a stronger (numerically lower) BullMQ priority, or the same priority with an
 * earlier `createdAt` (ties broken by `id` so two same-millisecond jobs never
 * report the same position). Position 1 = next up.
 */
export async function getQueuePosition(job: {
  id: string;
  type: JobType;
  status: string;
  createdAt: Date;
}): Promise<number | null> {
  if (job.status !== "PENDING") return null;

  const queueName = resolveQueueName(job.type);
  const priority = priorityFor(job.type);
  const sameQueueTypes = typesForQueue(queueName);
  const strongerTypes = sameQueueTypes.filter((type) => priorityFor(type) < priority);
  const samePriorityTypes = sameQueueTypes.filter((type) => priorityFor(type) === priority);

  const ahead = await prisma.aiJob.count({
    where: {
      status: "PENDING",
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
