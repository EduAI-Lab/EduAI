import prisma from "~/lib/prisma.server";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import { JobPayloadSchema, type JobPayload } from "./job-schema";
import { getQueue } from "./queues.server";
import { priorityFor, resolveQueueName } from "./resolve-pool.server";

/**
 * Producer entry point for the async AI-job queue — the single seam used by
 * `app/lib/ai/` call sites (contract §6). Creates the durable `AiJob` row
 * (source of truth), pushes the job onto the resolved BullMQ pool queue, and
 * returns the DB-backed job id.
 *
 * The Postgres row is authoritative; if the Redis add fails between steps 3 and
 * 4 the row is left `PENDING` with no `bullJobId` — a reaper (#915) sweeps such
 * orphans. Backpressure / queue-full rejection is also #915; this function only
 * guarantees the signature and the row lifecycle below.
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

  // 3. Create the AiJob row as PENDING (payload = the validated job).
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

  // 4. Add to that queue with priority; BullMQ job name = kind.
  //    idempotencyKey, when present, becomes the BullMQ job id so a re-enqueue is a no-op.
  try {
    const bullJob = await getQueue(queueName).add(payload.kind, payload, {
      jobId: payload.idempotencyKey,
      priority,
    });

    // 5. Persist the BullMQ id back onto the row.
    if (bullJob.id) {
      await prisma.aiJob.update({
        where: { id: aiJob.id },
        data: { bullJobId: bullJob.id },
      });
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
