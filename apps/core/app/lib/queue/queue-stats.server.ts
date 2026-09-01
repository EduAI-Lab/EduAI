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
 *
 * `now` is injectable so a caller reading depth and position as a pair can pin
 * one cutoff across both — two `Date.now()` values would age the same orphan
 * differently between the two queries.
 */
function inTransportFilter(now: Date): Prisma.AiJobWhereInput {
  return {
    OR: [
      { bullJobId: { not: null } },
      { createdAt: { gt: new Date(now.getTime() - PENDING_WITHOUT_BULL_GRACE_MS) } },
    ],
  };
}

/**
 * Either the base client or an interactive-transaction client — the reads below
 * are identical in both, and `getQueueSnapshot()` needs to run them on a `tx`.
 */
type StatsClient = Prisma.TransactionClient;

/** Shared options for the stats reads: which client to run on, and the grace cutoff. */
type StatsReadOptions = { client?: StatsClient; now?: Date };

/** The `AiJob` fields a position read needs — the row itself, not a full record. */
type QueuePositionInput = {
  id: string;
  type: JobType;
  status: string;
  createdAt: Date;
  queueName?: string | null;
};

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
export async function getQueueDepth(
  queueName: QueueName,
  { client = prisma, now = new Date() }: StatsReadOptions = {},
): Promise<number> {
  return client.aiJob.count({
    where: { status: "PENDING", queueName, ...inTransportFilter(now) },
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
export async function getQueuePosition(
  job: QueuePositionInput,
  { client = prisma, now = new Date() }: StatsReadOptions = {},
): Promise<number | null> {
  if (job.status !== "PENDING") return null;

  const queueName = job.queueName ?? resolveQueueName(job.type);
  const priority = priorityFor(job.type);
  const strongerTypes = ALL_JOB_TYPES.filter((type) => priorityFor(type) < priority);
  const samePriorityTypes = ALL_JOB_TYPES.filter((type) => priorityFor(type) === priority);

  const ahead = await client.aiJob.count({
    where: {
      status: "PENDING",
      queueName,
      id: { not: job.id },
      AND: [
        inTransportFilter(now),
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

/**
 * Position and depth for one row, read as a mutually consistent pair (#915).
 *
 * `ahead` is a strict subset of the depth set, so `position = ahead + 1 <= depth`
 * holds within a single snapshot — but not across two. Read separately, a job
 * draining `PENDING -> RUNNING` between them shrinks depth below a position that
 * already counted it as ahead, so a client can see `queuePosition > queueDepth`.
 * (Nothing drains PENDING until the #168 dispatch worker exists, so this is
 * latent today and live the moment it lands.)
 *
 * REPEATABLE READ is load-bearing, not decoration: under Postgres' default READ
 * COMMITTED every statement takes a fresh snapshot — including statements inside
 * a transaction — so wrapping these two counts in a plain transaction would not
 * fix anything. The reads are sequential rather than parallel because they share
 * one connection, and the snapshot is fixed at the first statement either way.
 *
 * Read-only, so there is no lock contention and no serialization-failure retry
 * to handle. The caller decides how a failure degrades.
 */
export async function getQueueSnapshot(
  job: QueuePositionInput,
  queueName: QueueName,
): Promise<{ queuePosition: number | null; queueDepth: number }> {
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      const queuePosition = await getQueuePosition(job, { client: tx, now });
      const queueDepth = await getQueueDepth(queueName, { client: tx, now });
      return { queuePosition, queueDepth };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
