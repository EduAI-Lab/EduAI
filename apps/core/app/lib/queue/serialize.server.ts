import type { AiJob } from "@prisma/client";

/**
 * Client-facing snapshot of an `AiJob` (ISO timestamps), mirroring
 * `serializeReEmbedJob` in `app/lib/ai/re-embed-job.server.ts`.
 *
 * Contract §8: this read model is the single source of queue position and ETA.
 * `queuePosition` is computed live per poll (PENDING jobs ahead in the same
 * queue) and ETA is derived from rolling durations — both are #917. For #914 the
 * field is present in the shape but returned as `null`; nothing persists it.
 */
export function serializeAiJob(job: AiJob) {
  return {
    id: job.id,
    kind: job.kind,
    type: job.type,
    source: job.source,
    status: job.status,
    queuePosition: null as number | null, // computed live at read time (#917)
    result: job.result ?? null,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
