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
import { isInfrastructureError, toQueueUnavailable } from "./errors.server";

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
 * Mark a PENDING AiJob row FAILED when it never made it onto BullMQ, or when
 * we can no longer be sure it will (#1112 / #1269 review compensation).
 * Best-effort — never masks the original enqueue failure. Deliberately does
 * NOT delete the row: a deleted row lets a caller holding its id poll forever
 * against nothing (404), and lets a retry with the same idempotencyKey sail
 * past the step-3 fast path and mint a second row — which, if `queue.add()`
 * actually succeeded in Redis before the client-visible failure (e.g. a
 * response timeout), silently no-ops on re-add and leaves that second row
 * stuck PENDING forever. Marking FAILED keeps the row as the one thing both
 * a status poll and a same-key retry will find.
 *
 * Known residual gap: if `queue.add()` timed out but Redis actually accepted
 * the job, this marks the row FAILED even though a worker may still process
 * it (and could still write a result to this same row via the embedded
 * `aiJobId`, racing the FAILED write). That ambiguity is inherent to an
 * unreliable channel between the two stores and isn't resolved here —
 * closing it fully needs a reconciliation sweep that reconfirms real Redis
 * job state, which is out of scope for this fix.
 */
async function markAiJobEnqueueFailed(
  jobId: string,
  userId: string,
  queueName: string,
  cause: unknown,
): Promise<void> {
  try {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: cause instanceof Error ? cause.message : "Failed to enqueue job",
        completedAt: new Date(),
      },
    });
  } catch (compensateError) {
    fireAndForget(
      logSystemError({
        source: "AI",
        code: "ai_job_orphan_compensate_failed",
        message: `Failed to mark orphaned PENDING AI job ${jobId} FAILED after queue push failure`,
        error: compensateError,
        actorUserId: userId,
        details: { jobId, queueName },
      }),
    );
  }
}

/**
 * Producer entry point for the async AI-job queue — the single seam used by
 * `app/lib/ai/` call sites (contract §6). Creates the durable `AiJob` row
 * (source of truth), pushes the job onto the resolved BullMQ pool queue, and
 * returns the DB-backed job id plus a live queue position/depth snapshot.
 *
 * The Postgres row is authoritative; Postgres and Redis are not one ACID
 * store, so this can't be a single transaction. Instead:
 *
 *   - The row is created PENDING with `queue.add()`'s own id (`aiJob.id`)
 *     embedded in the payload as `aiJobId`, so a worker can always find its
 *     row independent of whether `bullJobId` is ever persisted (#1112 review).
 *   - For a **keyed** job, `bullJobId` is set to `idempotencyKey` *at create
 *     time* — the same value passed to `queue.add({ jobId: idempotencyKey })`
 *     below, which BullMQ always echoes back unchanged. The row is therefore
 *     discoverable by the step-3 idempotency lookup from the instant it
 *     exists, regardless of whether `queue.add()` ever runs, succeeds, or
 *     this function crashes before returning (#1269 review: a FAILED-not-
 *     deleted row with a still-null `bullJobId` was invisible to a same-key
 *     retry, and so was a PENDING row that lost a post-add persist). This
 *     also means two concurrent enqueues on the same key now race at
 *     `create()` — resolved below — instead of racing at `queue.add()` and
 *     the post-add persist, so there is only ever one physical Redis call
 *     for a given key, not one per racer.
 *   - For an **unkeyed** job, BullMQ's auto-generated id isn't known until
 *     `queue.add()` returns, so `bullJobId` is still persisted after the add
 *     (step 7) — purely for tracking/debugging, since unkeyed jobs never
 *     participate in the idempotency lookup. Auto-generated ids are a
 *     per-queue atomic counter, so unlike the keyed case this persist cannot
 *     hit a `(queueName, bullJobId)` conflict.
 *   - If `queue.add()` itself fails, the row is marked **FAILED** rather than
 *     deleted (`markAiJobEnqueueFailed`, #1269 review) — for both keyed and
 *     unkeyed jobs. A deleted keyed row lets a same-key retry mint a second
 *     row that can silently no-op against Redis if the original add actually
 *     succeeded (response timeout after Redis accepted it); a FAILED row is
 *     discoverable by both a status poll and the step-3 idempotency fast
 *     path instead — including a subsequent retry, since `bullJobId` is
 *     already persisted from create time.
 *
 * Infrastructure failures (DB or Redis unreachable) become
 * `QueueUnavailableError` (HTTP 503) rather than any of the above.
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
 * `jobId` returned to callers is always the `AiJob.id` (stable, DB-backed),
 * never the raw BullMQ id. `queuePosition` (1-based, null once not PENDING) and
 * `queueDepth` are live snapshots at enqueue time (#915); subsequent reads come
 * from the status endpoint (#917).
 */
export async function enqueue(job: JobPayload): Promise<EnqueueResult> {
  // 1. Validate (throws ZodError → 400 at the route).
  const payload = JobPayloadSchema.parse(job);

  // 2. Resolve target queue + priority from the fleet pool for `type` (shim).
  const queueName = resolveQueueName(payload.type);
  const priority = priorityFor(payload.type);

  // 3. Idempotency fast path: if a row already owns this key, return it — never
  //    create a second row for the same logical job.
  if (payload.idempotencyKey) {
    try {
      const existing = await prisma.aiJob.findUnique({
        where: { queueName_bullJobId: { queueName, bullJobId: payload.idempotencyKey } },
        select: { id: true, type: true, status: true, createdAt: true, queueName: true },
      });
      if (existing) {
        return { jobId: existing.id, ...(await queueStatsFor(existing, queueName)) };
      }
    } catch (error) {
      if (isInfrastructureError(error)) {
        throw toQueueUnavailable(error, "Database unavailable while checking job idempotency");
      }
      throw error;
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

  // 5. Create the AiJob row as PENDING (payload = the validated job). For a
  //    keyed job, bullJobId is set to the idempotencyKey right here — see the
  //    docstring above for why.
  let aiJob: { id: string; type: JobType; status: string; createdAt: Date; queueName: string | null };
  try {
    aiJob = await prisma.aiJob.create({
      data: {
        kind: payload.kind,
        type: payload.type,
        source: payload.source,
        status: "PENDING",
        payload,
        userId: payload.userId,
        courseId: payload.courseId ?? null,
        queueName,
        ...(payload.idempotencyKey ? { bullJobId: payload.idempotencyKey } : {}),
      },
      select: { id: true, type: true, status: true, createdAt: true, queueName: true },
    });
  } catch (error) {
    if (payload.idempotencyKey && isBullJobIdConflict(error)) {
      // Lost a create-time race against a concurrent enqueue on the same
      // idempotencyKey — closes the step-3-to-here TOCTOU window. The winner
      // owns this logical job; return it instead of proceeding to a
      // redundant queue.add() (#1269 review).
      const winner = await prisma.aiJob.findUnique({
        where: { queueName_bullJobId: { queueName, bullJobId: payload.idempotencyKey } },
        select: { id: true, type: true, status: true, createdAt: true, queueName: true },
      });
      if (winner) {
        return { jobId: winner.id, ...(await queueStatsFor(winner, queueName)) };
      }
      // The winner's row vanished between the conflict and this read (e.g.
      // it hit its own compensation path) — surface the original conflict
      // rather than silently retrying or minting a duplicate here.
    }
    if (isInfrastructureError(error)) {
      throw toQueueUnavailable(error, "Database unavailable while creating AI job");
    }
    throw error;
  }

  // 6. Add to that queue with priority; BullMQ job name = kind. `aiJobId` is
  //    embedded in the payload itself so a worker can always locate this row,
  //    independent of whether the bullJobId persist below ever runs (#1112
  //    review). idempotencyKey, when present, becomes the BullMQ job id so a
  //    re-enqueue is a no-op.
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
    // Redis down / queue unreachable. Mark FAILED rather than delete — for
    // both keyed and unkeyed rows (#1269 review): a deleted keyed row lets a
    // same-key retry mint a second row that can silently no-op against Redis
    // if this add actually succeeded despite the client-visible failure.
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
    await markAiJobEnqueueFailed(aiJob.id, payload.userId, queueName, error);
    if (isInfrastructureError(error)) {
      throw toQueueUnavailable(error, "Queue unavailable");
    }
    throw error;
  }

  // 7. Persist BullMQ's auto-generated id for tracking/debugging — unkeyed
  //    jobs only. A keyed job's bullJobId was already set to the
  //    idempotencyKey at create time (step 5) and queue.add({ jobId:
  //    idempotencyKey }) always echoes that same id back, so there is
  //    nothing new to persist and, unlike an auto-generated id, no
  //    (queueName, bullJobId) conflict this could hit. The job is already
  //    durably queued and reachable via the embedded aiJobId regardless of
  //    whether this succeeds, so a failure here must NOT mark the row
  //    FAILED — only a future debugging lookup by bullJobId would miss it.
  if (!payload.idempotencyKey && bullJob.id) {
    try {
      await prisma.aiJob.update({
        where: { id: aiJob.id },
        data: { bullJobId: bullJob.id },
      });
    } catch (updateError) {
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
      if (isInfrastructureError(updateError)) {
        throw toQueueUnavailable(updateError, "Database unavailable while persisting queue job id");
      }
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
