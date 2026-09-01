import type { JsonObject, JsonValue } from "~/lib/json-value";
import type { EnqueueResult } from "./enqueue.server";
import {
  AiJobQueueDisabledError,
  assertAiJobQueueEnabled,
  isAiJobQueueEnabled,
} from "./availability.server";

/**
 * Compatibility seam for callers that still send `enqueue: true`.
 *
 * The pre-MVP async contract is incomplete, so this always returns false. The
 * legacy `QUEUE_ENQUEUE_ENABLED` environment variable is intentionally ignored:
 * deployment configuration cannot expose the unfinished producer path.
 */
export function isEnqueueRequested(): boolean {
  return isAiJobQueueEnabled();
}

export type ChatEnqueueParams = {
  body: JsonObject;
  messages: JsonValue[];
  userId: string;
  courseId?: string;
  requestedModel?: string;
};

/**
 * Fail closed if a dormant or future call site reaches the old producer seam.
 * No request content, client-selected model, or idempotency key is persisted.
 */
export async function enqueueQuestionGeneration(
  _params: ChatEnqueueParams,
): Promise<EnqueueResult> {
  assertAiJobQueueEnabled();
  // Keep the compatibility seam fail-closed even if the central boundary is
  // deliberately refactored later; re-enablement must replace this producer.
  throw new AiJobQueueDisabledError();
}
