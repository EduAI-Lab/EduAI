import type { Job } from "bullmq";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import {
  JobPayloadSchema,
  type JobPayload,
  type QueuedJobPayload,
} from "./job-schema";
import { getQueue } from "./queues.server";
import { priorityFor, resolveQueueName } from "./resolve-pool.server";

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

/**
 * Producer entry point for the async AI-job queue — the single seam used by
 * `app/lib/ai/` call sites (contract §6). Creates the durable `AiJob` row
 * (source of truth), pushes the job onto the resolved BullMQ pool queue, and
 * returns the DB-backed job id.
 *
 * The Postgres row is authoritative; if the Redis add fails between steps 4 and
 * 5 the row is left `PENDING` with no `bullJobId` — a reaper (#915) sweeps such
 * orphans. Backpressure / queue-full rejection is also #915; this function only
 * guarantees the signature and the row lifecycle below.
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
 * never the raw BullMQ id.
 */
export async function enqueue(job: JobPayload): Promise<{ jobId: string }> {
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
      select: { id: true },
    });
    if (existing) {
      return { jobId: existing.id };
    }
  }

  // 4. Create the AiJob row as PENDING (payload = the validated job).
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
    select: { id: true },
  });

  // 5. Add to that queue with priority; BullMQ job name = kind.
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
    // Redis down / queue unreachable: the PENDING row stays without a bullJobId
    // for the #915 reaper. Surface the failure to the caller so the route can 5xx.
    // Scoped to the `add` alone — a failure of the step-6 update below is a
    // different fault and must not be logged as a queue outage.
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

  // 6. Persist the BullMQ id back onto the row.
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
          select: { id: true, status: true },
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
            return { jobId: aiJob.id };
          } catch {
            // Extremely rare double race (another row grabbed the slot in the
            // instant between the delete and this retry). Our row is still the
            // one being executed, so we must not delete it below — just report
            // our own id; the row runs to completion without a persisted
            // bullJobId, which only affects a hypothetical redelivery lookup.
            return { jobId: aiJob.id };
          }
        }
      }

      if (ownRowClaimed) {
        // Our row is claimed/in flight but we couldn't safely reconcile the
        // spurious duplicate above (it was no longer PENDING either — an even
        // rarer race). Never delete a claimed row; just report our own id.
        return { jobId: aiJob.id };
      }

      // Standard case: our row is still PENDING — we really did lose the
      // idempotency race. Drop our duplicate row and return the row that
      // legitimately owns the bullJobId.
      await prisma.aiJob.delete({ where: { id: aiJob.id } }).catch(() => undefined);
      const winner = await prisma.aiJob.findUnique({
        where: { queueName_bullJobId: { queueName, bullJobId: bullJob.id } },
        select: { id: true },
      });
      if (winner) {
        return { jobId: winner.id };
      }
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

  // 6. Return the durable handle only. Queue position / ETA come from the status
  //    endpoint (#917), never from here.
  return { jobId: aiJob.id };
}
