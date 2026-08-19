import type { AiJob } from "@prisma/client";

/**
 * Client-facing snapshot of an `AiJob` (ISO timestamps), mirroring
 * `serializeReEmbedJob` in `app/lib/ai/re-embed-job.server.ts`.
 *
 * Contract §8: this read model is the single source of queue position and ETA.
 * `queuePosition` is computed live per read via `getQueuePosition()` in
 * `queue-stats.server.ts` (#915) and passed in by the caller — nothing persists
 * it. ETA from rolling durations is computed by the status endpoint too.
 */
export function serializeAiJob(
  job: AiJob,
  options?: { queuePosition?: number | null; etaSeconds?: number | null },
) {
  return {
    id: job.id,
    kind: job.kind,
    type: job.type,
    source: job.source,
    status: job.status,
    queuePosition: options?.queuePosition ?? null,
    etaSeconds: options?.etaSeconds ?? null,
    result: job.result ?? null,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
