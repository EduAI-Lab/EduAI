import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import { JobPayloadSchema, type JobPayload, type JobType } from "./job-schema";
import {
  getQueueDepth,
  getQueuePosition,
  maxQueueDepth,
  QueueFullError,
} from "./queue-stats.server";
import { getQueue } from "./queues.server";
import { priorityFor, resolveQueueName, type QueueName } from "./resolve-pool.server";

/** True for a unique-constraint violation on `AiJob.bullJobId`. */
function isBullJobIdConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (error.meta?.target as string[] | undefined)?.includes("bullJobId") === true
  );
}

export type EnqueueResult = {
  jobId: string;
  /** Live 1-based position in the resolved queue; null once the job is not PENDING (or the read failed). */
  queuePosition: number | null;
  /** Live count of PENDING jobs in the resolved queue (includes this job); null when the read failed. */
  queueDepth: number | null;
};

/**
 * Live position + depth snapshot for a row, computed in parallel (#915).
 * Never throws: by the time this runs the job is durably enqueued, and a
 * transient stats-read failure must not surface as a 502 for a job that
 * actually made it in (the retry would enqueue a duplicate). `knownDepth`
 * skips the depth query when the caller already counted (backpressure check).
 */
async function queueStatsFor(
  row: { id: string; type: JobType; status: string; createdAt: Date },
  queueName: QueueName,
  knownDepth?: number,
): Promise<{ queuePosition: number | null; queueDepth: number | null }> {
  try {
    const [queuePosition, queueDepth] = await Promise.all([
      getQueuePosition(row),
      knownDepth !== undefined ? Promise.resolve(knownDepth) : getQueueDepth(queueName),
    ]);
    return { queuePosition, queueDepth };
  } catch {
    return { queuePosition: null, queueDepth: null };
  }
}

/**
 * Producer entry point for the async AI-job queue — the single seam used by
 * `app/lib/ai/` call sites (contract §6). Creates the durable `AiJob` row
 * (source of truth), pushes the job onto the resolved BullMQ pool queue, and
 * returns the DB-backed job id.
 *
 * The Postgres row is authoritative; if the Redis add (step 6) fails, an
 * unkeyed row is left `PENDING` with no `bullJobId` for a reaper (deferred, see
 * the #914 plan doc) — a keyed row is deleted instead so its replay isn't
 * blocked (see the catch below). Stats reads age unkeyed orphans out.
 *
 * Backpressure (#915): when `QUEUE_MAX_DEPTH` is set, an enqueue into a queue
 * already holding that many PENDING jobs rejects with `QueueFullError` before
 * any row is written — the route maps it to a 429 with `Retry-After`. An
 * idempotent replay of an existing job is never rejected (nothing new is added).
 *
 * Idempotency: when `idempotencyKey` is set it is the BullMQ job id (dedupes the
 * queue) AND the `AiJob.bullJobId` (`@unique`), so one logical key maps to exactly
 * one row. A repeat enqueue returns the existing row instead of writing a new one.
 *
 * `jobId` returned to callers is always the `AiJob.id` (stable, DB-backed),
 * never the raw BullMQ id. `queuePosition` (1-based, null once not PENDING) and
 * `queueDepth` are live snapshots at enqueue time (#915); subsequent reads come
 * from the status endpoint (#917).
 */
export async function enqueue(job: JobPayload): Promise<EnqueueResult> {
  // 1. Validate (throws on failure → 400 at the route).
  const payload = JobPayloadSchema.parse(job);

  // 2. Resolve target queue + priority from the fleet pool for `type` (shim).
  const queueName = resolveQueueName(payload.type);
  const priority = priorityFor(payload.type);

  // 3. Idempotency fast path: if a row already owns this key, return it — never
  //    create a second row for the same logical job.
  if (payload.idempotencyKey) {
    const existing = await prisma.aiJob.findUnique({
      where: { bullJobId: payload.idempotencyKey },
      select: { id: true, type: true, status: true, createdAt: true },
    });
    if (existing) {
      // Depth/position follow the existing row's own type — a replay may carry
      // a different `type` than the row that owns the key.
      return { jobId: existing.id, ...(await queueStatsFor(existing, resolveQueueName(existing.type))) };
    }
  }

  // 4. Backpressure (#915): reject before writing anything when the target
  //    queue is saturated. Disabled unless QUEUE_MAX_DEPTH is set. The cap is
  //    approximate — check-then-act with no transaction, so a burst of
  //    concurrent enqueues can briefly overshoot it. Acceptable for a soft
  //    protective limit; a serialized count-and-insert isn't worth the hot-path
  //    contention.
  const maxDepth = maxQueueDepth();
  let depthAtCheck: number | null = null;
  if (maxDepth !== null) {
    depthAtCheck = await getQueueDepth(queueName);
    if (depthAtCheck >= maxDepth) {
      throw new QueueFullError(queueName, depthAtCheck, maxDepth);
    }
  }

  // 5. Create the AiJob row as PENDING (payload = the validated job).
  const aiJob = await prisma.aiJob.create({
    data: {
      kind: payload.kind,
      type: payload.type,
      source: payload.source,
      status: "PENDING",
      payload,
      userId: payload.userId,
      courseId: payload.courseId ?? null,
    },
    select: { id: true, type: true, status: true, createdAt: true },
  });

  // 6. Add to that queue with priority; BullMQ job name = kind.
  //    idempotencyKey, when present, becomes the BullMQ job id so a re-enqueue is a no-op.
  try {
    const bullJob = await getQueue(queueName).add(payload.kind, payload, {
      jobId: payload.idempotencyKey,
      priority,
    });

    // 7. Persist the BullMQ id back onto the row.
    if (bullJob.id) {
      try {
        await prisma.aiJob.update({
          where: { id: aiJob.id },
          data: { bullJobId: bullJob.id },
        });
      } catch (updateError) {
        // A concurrent enqueue with the same idempotencyKey already claimed this
        // bullJobId. Drop our duplicate PENDING row and return the row that won.
        if (isBullJobIdConflict(updateError)) {
          await prisma.aiJob.delete({ where: { id: aiJob.id } }).catch(() => undefined);
          const winner = await prisma.aiJob.findUnique({
            where: { bullJobId: bullJob.id },
            select: { id: true, type: true, status: true, createdAt: true },
          });
          if (winner) {
            return { jobId: winner.id, ...(await queueStatsFor(winner, resolveQueueName(winner.type))) };
          }
        }
        throw updateError;
      }
    }
  } catch (error) {
    // Redis down / queue unreachable. A keyed job must not leave an orphan: the
    // idempotency fast path looks rows up by bullJobId (= the key), which was
    // never persisted here, so the orphan would be invisible to the client's
    // retry and the retry would create a duplicate row for the same logical
    // job. Drop it so the replay recreates cleanly. Unkeyed orphans stay for
    // the (deferred) reaper; stats reads age them out after
    // PENDING_WITHOUT_BULL_GRACE_MS so they can't wedge the backpressure cap.
    if (payload.idempotencyKey) {
      await prisma.aiJob.delete({ where: { id: aiJob.id } }).catch(() => undefined);
    }
    // Surface the failure to the caller so the route can 5xx.
    fireAndForget(
      logSystemError({
        source: "AI",
        code: "ai_job_enqueue_failed",
        message: `Failed to add AI job ${aiJob.id} to queue ${queueName}`,
        error,
        actorUserId: payload.userId,
        details: { jobId: aiJob.id, kind: payload.kind, type: payload.type, queueName },
      }),
    );
    throw error;
  }

  // 8. Return the durable handle plus a live position/depth snapshot (#915).
  //    Reuse the backpressure count (+1 for this job) when it ran; subsequent
  //    polls read fresher values from the status endpoint (#917).
  return {
    jobId: aiJob.id,
    ...(await queueStatsFor(aiJob, queueName, depthAtCheck === null ? undefined : depthAtCheck + 1)),
  };
}
