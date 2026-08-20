/**
 * The durable AI-job queue is intentionally unavailable before MVP.
 *
 * Its owner-scoped status/cancellation API and server-side model authorization
 * contract are not complete yet. This compile-time boundary deliberately does
 * not consult an environment variable: deployment configuration alone cannot
 * make the unfinished path reachable.
 */
export const AI_JOB_QUEUE_PRE_MVP_DISABLED = true as const;

export class AiJobQueueDisabledError extends Error {
  readonly code = "AI_JOB_QUEUE_DISABLED_PRE_MVP";

  constructor() {
    super("AI job queue is disabled pre-MVP");
    this.name = "AiJobQueueDisabledError";
  }
}

export function isAiJobQueueEnabled(): boolean {
  return false;
}

// Kept as `void` so dormant implementations remain typechecked even though the
// current runtime boundary always throws.
export function assertAiJobQueueEnabled(): void {
  throw new AiJobQueueDisabledError();
}
