import { enqueue } from "./enqueue.server";
import { JobTypeSchema, type JobType } from "./job-schema";

/**
 * Guarded producer branch for the `/api/chat` question-generation call site
 * (contract §6, issue #914). Off by default: it fires only when
 * `QUEUE_ENQUEUE_ENABLED=true` AND the request explicitly opts in with
 * `enqueue: true`. Normal interactive chat never enters this path, so the live
 * synchronous stream is untouched until the dispatch worker (#168) exists to
 * drain the queue.
 *
 * Integration seam: QM's `eduaiService` must send `{ enqueue: true, source,
 * feature }` for this to fire — not flipped in #914.
 */
export function isEnqueueRequested(body: unknown): boolean {
  if (process.env.QUEUE_ENQUEUE_ENABLED !== "true") {
    return false;
  }
  return typeof body === "object" && body !== null && (body as { enqueue?: unknown }).enqueue === true;
}

// featureToJobType shim. `question-generation` is background work by default.
// TODO(#168): replace with the fleet's `featureToJobType()` from fleet/types.ts.
function resolveJobType(feature: unknown): JobType {
  const parsed = JobTypeSchema.safeParse(feature);
  return parsed.success ? parsed.data : "background";
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
 * Returns the durable `{ jobId }`. Throws (ZodError) on an invalid payload —
 * the route maps that to a 400.
 */
export async function enqueueQuestionGeneration(params: ChatEnqueueParams): Promise<{ jobId: string }> {
  const { body, messages, userId, courseId, requestedModel } = params;
  const type = resolveJobType(body.feature);
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
