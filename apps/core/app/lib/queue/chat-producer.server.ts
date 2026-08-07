import {
  jobTypeForWorkloadFeature,
  parseWorkloadFeature,
  type JobType,
} from "~/lib/ai/routing/fleet/types";
import { enqueue, type EnqueueResult } from "./enqueue.server";

/**
 * Guarded producer branch for the `/api/chat` question-generation call site
 * (contract §6, issue #914). Off by default: it fires only when
 * `QUEUE_ENQUEUE_ENABLED=true` AND the request explicitly opts in with
 * `enqueue: true`. Normal interactive chat never enters this path, so the live
 * synchronous stream is untouched unless the guarded producer is explicitly
 * enabled. Deployments that enable it must run `npm run queue:worker`.
 *
 * Integration seam: QM's `eduaiService` must send `{ enqueue: true, source,
 * routingContext }` for this to fire — not flipped in #914.
 */
export function isEnqueueRequested(body: unknown): boolean {
  if (process.env.QUEUE_ENQUEUE_ENABLED !== "true") {
    return false;
  }
  return typeof body === "object" && body !== null && (body as { enqueue?: unknown }).enqueue === true;
}

// Resolve the fleet job type (interactive | background) from the request's
// routingContext — the same input the sync router reads (fleet/types.ts). An
// explicit `routingContext.jobType` wins; otherwise it is derived from the
// workload feature (question-maker => background), never from misreading a
// feature string as a job type.
function resolveJobType(routingContext: unknown): JobType {
  if (routingContext && typeof routingContext === "object") {
    const jobType = (routingContext as { jobType?: unknown }).jobType;
    if (jobType === "interactive" || jobType === "background") {
      return jobType;
    }
  }
  return jobTypeForWorkloadFeature(parseWorkloadFeature(routingContext));
}

/** Best-effort extraction of the latest user prompt from a chat `messages` array. */
function lastUserPrompt(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (typeof m !== "object" || m === null) continue;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .map((part) =>
          typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
        )
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

export type ChatEnqueueParams = {
  body: Record<string, unknown>;
  messages: unknown[];
  userId: string;
  courseId?: string;
  requestedModel?: string;
};

/**
 * Build a `question-generation` job from a `/api/chat` request and enqueue it.
 * Returns the durable `jobId` plus a live `queuePosition`/`queueDepth` snapshot
 * (#915). Throws `ZodError` on an invalid payload (route maps to 400) and
 * `QueueFullError` when the queue is saturated (route maps to 429).
 */
export async function enqueueQuestionGeneration(params: ChatEnqueueParams): Promise<EnqueueResult> {
  const { body, messages, userId, courseId, requestedModel } = params;
  const type = resolveJobType(body.routingContext);
  const rawCount = body.count;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : 1;

  return enqueue({
    kind: "question-generation",
    type,
    source: typeof body.source === "string" && body.source.trim() ? body.source : "unknown",
    userId,
    courseId,
    input: {
      kind: "question-generation",
      courseId: courseId ?? "",
      prompt: lastUserPrompt(messages),
      count,
    },
    requestedModel,
    idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  });
}
