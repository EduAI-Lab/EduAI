import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import { JobPayloadSchema, type JobPayload } from "./job-schema";
import { getQueue } from "./queues.server";
import { priorityFor, resolveQueueName } from "./resolve-pool.server";

/** True for a unique-constraint violation on `AiJob.bullJobId`. */
function isBullJobIdConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (error.meta?.target as string[] | undefined)?.includes("bullJobId") === true
  );
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
 * queue) AND the `AiJob.bullJobId` (`@unique`), so one logical key maps to exactly
 * one row. A repeat enqueue returns the existing row instead of writing a new one.
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
      where: { bullJobId: payload.idempotencyKey },
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
    },
    select: { id: true },
  });

  // 5. Add to that queue with priority; BullMQ job name = kind.
  //    idempotencyKey, when present, becomes the BullMQ job id so a re-enqueue is a no-op.
  try {
    const bullJob = await getQueue(queueName).add(payload.kind, payload, {
      jobId: payload.idempotencyKey,
      priority,
    });

    // 6. Persist the BullMQ id back onto the row.
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
            select: { id: true },
          });
          if (winner) {
            return { jobId: winner.id };
          }
        }
        throw updateError;
      }
    }
  } catch (error) {
    // Redis down / queue unreachable: the PENDING row stays without a bullJobId
    // for the #915 reaper. Surface the failure to the caller so the route can 5xx.
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

  // 6. Return the durable handle only. Queue position / ETA come from the status
  //    endpoint (#917), never from here.
  return { jobId: aiJob.id };
}
