import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import {
  JobPayloadSchema,
  type JobPayload,
  type JobType,
  type QueuedJobPayload,
} from "./job-schema";
import {
  getQueueDepth,
  getQueueSnapshot,
  maxQueueDepth,
  QueueFullError,
} from "./queue-stats.server";
import { getQueue } from "./queues.server";
import { priorityFor, resolveQueueName, type QueueName } from "./resolve-pool.server";

/** True for a unique-constraint violation on `AiJob(queueName, bullJobId)`. */
function isBullJobIdConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (error.meta?.target as string[] | undefined)?.includes("bullJobId") === true
  );
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function aiJobRetryOptions(): {
  attempts: number;
  backoff: { type: "exponential"; delay: number };
} {
  return {
    attempts: positiveInt(process.env.AI_JOB_ATTEMPTS, 3),
    backoff: {
      type: "exponential",
      delay: positiveInt(process.env.AI_JOB_RETRY_DELAY_MS, 5_000),
    },
  };
}

export type EnqueueResult = {
  jobId: string;
  /** Live 1-based position in the resolved queue; null once the job is not PENDING (or the read failed). */
  queuePosition: number | null;
  /** Live count of PENDING jobs in the resolved queue (includes this job); null when the read failed. */
  queueDepth: number | null;
};

/**
 * Live position + depth snapshot for a row (#915).
 *
 * Never throws: by the time this runs the job is durably enqueued, and a
 * transient stats-read failure must not surface as a 502 for a job that
 * actually made it in (the retry would enqueue a duplicate).
 *
 * Both halves are read here, after the row exists — never reused from the
 * pre-write backpressure count, which is taken before the insert and would let
 * `count + 1` disagree with a freshly-read position. `getQueueSnapshot()` then
 * reads the pair under REPEATABLE READ so they also cannot disagree in the
 * other direction, when jobs drain out between the two counts.
 */
async function queueStatsFor(
  row: { id: string; type: JobType; status: string; createdAt: Date; queueName: string | null },
  queueName: QueueName,
): Promise<{ queuePosition: number | null; queueDepth: number | null }> {
  try {
    return await getQueueSnapshot(row, queueName);
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
 * queue) AND the `AiJob.bullJobId`, so one logical key maps to exactly one row.
 * A repeat enqueue returns the existing row instead of writing a new one. The
 * uniqueness is `(queueName, bullJobId)`, not `bullJobId` alone: BullMQ's
 * auto-generated ids are per-queue counters, so two pools both hand out `"1"`.
 *
 * Two concurrent enqueues sharing an `idempotencyKey` each create their own row
 * before either persists `bullJobId` (step 6), and BullMQ dedupes `queue.add`
 * by `jobId` to exactly one physical job — so exactly one of those rows is the
 * one a worker will ever run (whichever row's id got embedded as `aiJobId` in
 * that physical job's data), and it is independent of which row wins the
 * `(queueName, bullJobId)` DB race. A worker can claim its row via the embedded
 * `aiJobId` fast path before this function's own `bullJobId` update runs. If
 * that happens to *our* row, deleting it on a later unique-constraint conflict
 * would drop the in-flight job's eventual result and leave the other (never
 * executed) row stuck `PENDING` forever — so the conflict handler checks which
 * row is actually claimed and only ever deletes the untouched, still-`PENDING`
 * one.
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
      where: { queueName_bullJobId: { queueName, bullJobId: payload.idempotencyKey } },
      select: { id: true, type: true, status: true, createdAt: true, queueName: true },
    });
    if (existing) {
      // The key is scoped to `queueName`, so the winner is in this queue by
      // construction — its own row is still what the snapshot is computed from.
      return { jobId: existing.id, ...(await queueStatsFor(existing, queueName)) };
    }
  }

  // 4. Backpressure (#915): reject before writing anything when the target
  //    queue is saturated. Disabled unless QUEUE_MAX_DEPTH is set. The cap is
  //    approximate — check-then-act with no transaction, so a burst of
  //    concurrent enqueues can briefly overshoot it. Acceptable for a soft
  //    protective limit; a serialized count-and-insert isn't worth the hot-path
  //    contention.
  const maxDepth = maxQueueDepth();
  if (maxDepth !== null) {
    const depthAtCheck = await getQueueDepth(queueName);
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
      queueName,
    },
    select: { id: true, type: true, status: true, createdAt: true, queueName: true },
  });

  // 6. Add to that queue with priority; BullMQ job name = kind.
  //    idempotencyKey, when present, becomes the BullMQ job id so a re-enqueue is a no-op.
  const queuedPayload: QueuedJobPayload = {
    ...payload,
    aiJobId: aiJob.id,
  };
  let bullJob: Job;
  try {
    bullJob = await getQueue(queueName).add(payload.kind, queuedPayload, {
      jobId: payload.idempotencyKey,
      priority,
      ...aiJobRetryOptions(),
    });
  } catch (error) {
    // Redis down / queue unreachable. Scoped to the `add` alone — a failure of
    // the step-7 update below is a different fault and must not be logged as a
    // queue outage.
    //
    // A keyed job must not leave an orphan: the idempotency fast path looks
    // rows up by (queueName, bullJobId), and the key was never persisted here,
    // so the orphan would be invisible to the client's retry and the retry
    // would create a duplicate row for the same logical job. Drop it so the
    // replay recreates cleanly. Unkeyed orphans stay for the (deferred) reaper;
    // stats reads age them out after PENDING_WITHOUT_BULL_GRACE_MS so they
    // can't wedge the backpressure cap.
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

  // 7. Persist the BullMQ id back onto the row.
  if (bullJob.id) {
    try {
      await prisma.aiJob.update({
        where: { id: aiJob.id },
        data: { bullJobId: bullJob.id },
      });
    } catch (updateError) {
      if (!isBullJobIdConflict(updateError)) {
        // The job is queued but the row never got its bullJobId — log it as its
        // own fault so the #915 reaper's orphans aren't confused with a Redis
        // outage.
        fireAndForget(
          logSystemError({
            source: "AI",
            code: "ai_job_bull_id_persist_failed",
            message: `Queued AI job ${aiJob.id} but failed to persist bullJobId ${bullJob.id}`,
            error: updateError,
            actorUserId: payload.userId,
            details: { jobId: aiJob.id, bullJobId: bullJob.id, queueName },
          }),
        );
        throw updateError;
      }

      // A concurrent enqueue with the same idempotencyKey already claimed this
      // (queueName, bullJobId). Two rows now exist for one logical job (`aiJob.id`
      // — ours — and whatever row won the DB race), but only one of them is the
      // row a worker will ever actually run: the one embedded as `aiJobId` in the
      // BullMQ job's data (BullMQ dedupes `queue.add` by `jobId`, so there is
      // exactly one physical job for this key). A worker can claim that row via
      // the embedded-id fast path in `worker.server.ts` *before* this update
      // runs, which means "our row already won the bullJobId race" and "our row
      // is the one being executed" are independent outcomes — either row can be
      // either one.
      //
      // If our own row is no longer PENDING, a worker has already claimed it via
      // the embedded aiJobId: it is the row actually in flight, and the row that
      // beat us to `bullJobId` is the spurious duplicate nobody will ever
      // process. Deleting *our* row in that case would silently drop the result
      // the worker is about to write and leave the spurious row PENDING forever
      // (the bug: worker finishes successfully, but the surviving row never
      // moves out of PENDING). Delete the spurious row instead and retry
      // stamping our own — it is safe to drop only while it is still PENDING,
      // i.e. still untouched by any worker.
      const [ownRow, otherRow] = await Promise.all([
        prisma.aiJob.findUnique({
          where: { id: aiJob.id },
          select: { status: true },
        }),
        prisma.aiJob.findUnique({
          where: { queueName_bullJobId: { queueName, bullJobId: bullJob.id } },
          select: { id: true, type: true, status: true, createdAt: true, queueName: true },
        }),
      ]);

      const ownRowClaimed = ownRow != null && ownRow.status !== "PENDING";

      if (ownRowClaimed && otherRow) {
        const droppedSpurious = await prisma.aiJob.deleteMany({
          where: { id: otherRow.id, status: "PENDING" },
        });
        if (droppedSpurious.count === 1) {
          try {
            await prisma.aiJob.update({
              where: { id: aiJob.id },
              data: { bullJobId: bullJob.id },
            });
            return { jobId: aiJob.id, ...(await queueStatsFor(aiJob, queueName)) };
          } catch {
            // Extremely rare double race (another row grabbed the slot in the
            // instant between the delete and this retry). Our row is still the
            // one being executed, so we must not delete it below — just report
            // our own id; the row runs to completion without a persisted
            // bullJobId, which only affects a hypothetical redelivery lookup.
            return { jobId: aiJob.id, ...(await queueStatsFor(aiJob, queueName)) };
          }
        }
      }

      if (ownRowClaimed) {
        // Our row is claimed/in flight but we couldn't safely reconcile the
        // spurious duplicate above (it was no longer PENDING either — an even
        // rarer race). Never delete a claimed row; just report our own id.
        return { jobId: aiJob.id, ...(await queueStatsFor(aiJob, queueName)) };
      }

      // Standard case: our row is still PENDING — we really did lose the
      // idempotency race. Drop our duplicate row and return the row that
      // legitimately owns the bullJobId.
      await prisma.aiJob.delete({ where: { id: aiJob.id } }).catch(() => undefined);
      const winner = await prisma.aiJob.findUnique({
        where: { queueName_bullJobId: { queueName, bullJobId: bullJob.id } },
        select: { id: true, type: true, status: true, createdAt: true, queueName: true },
      });
      if (winner) {
        return { jobId: winner.id, ...(await queueStatsFor(winner, queueName)) };
      }
      // The job is queued but the row never got its bullJobId — log it as its own
      // fault so the reaper's orphans aren't confused with a Redis outage.
      fireAndForget(
        logSystemError({
          source: "AI",
          code: "ai_job_bull_id_persist_failed",
          message: `Queued AI job ${aiJob.id} but failed to persist bullJobId ${bullJob.id}`,
          error: updateError,
          actorUserId: payload.userId,
          details: { jobId: aiJob.id, bullJobId: bullJob.id, queueName },
        }),
      );
      throw updateError;
    }
  }

  // 8. Return the durable handle plus a live position/depth snapshot (#915).
  //    Read after the row exists and under one REPEATABLE READ snapshot, so
  //    depth always counts this job and can never come in below the reported
  //    position; later polls read fresher values from the status endpoint (#917).
  return {
    jobId: aiJob.id,
    ...(await queueStatsFor(aiJob, queueName)),
  };
}
