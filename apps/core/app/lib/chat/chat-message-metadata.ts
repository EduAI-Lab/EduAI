import { z } from "zod";

import { jsonObjectSchema } from "~/lib/json-value";
import type { JsonObject } from "~/lib/json-value";

/**
 * The server-owned fields this module reads and writes.
 *
 * Each field decodes independently (`.catch(undefined)`): stored metadata has
 * accumulated values from older writers, and one corrupt field must not hide
 * the others — a row whose `wasAutoRouted` is a leftover string should still
 * yield its `resolvedModelId`.
 */
const chatMessageMetadataSchema = z.object({
  resolvedModelId: z.string().optional().catch(undefined),
  wasAutoRouted: z.boolean().optional().catch(undefined),
  courseScopeRedirect: z.boolean().optional().catch(undefined),
});

export type ChatMessageMetadata = z.infer<typeof chatMessageMetadataSchema>;

/**
 * A message carrying a metadata slot, from either side of the wire: a stored
 * row's parsed JSON, or a live AI-SDK message the client holds. The slot is
 * unparsed because this module is what parses it.
 */
export type MessageWithMetadata = { metadata?: unknown };

/** Decodes the metadata slot. A message with none, or with a non-object there, reads as empty. */
function readMetadata(message: MessageWithMetadata): ChatMessageMetadata {
  const decoded = chatMessageMetadataSchema.safeParse(message.metadata);
  return decoded.success ? decoded.data : {};
}

/**
 * The metadata already on a message, preserved verbatim.
 *
 * The writers below own three fields but must not drop whatever else a message
 * carries, so the existing slot is kept as an open JSON object rather than
 * narrowed to {@link ChatMessageMetadata}.
 */
function existingMetadata<T extends object>(message: T): JsonObject {
  const decoded = jsonObjectSchema.safeParse("metadata" in message ? message.metadata : undefined);
  return decoded.success ? decoded.data : {};
}

/**
 * Read the server-owned model metadata attached to an assistant message.
 * Registry ids have the form `provider:model`; reject malformed stored JSON
 * rather than letting arbitrary metadata become a user-facing label.
 */
export function resolvedModelIdFromMessage(message: MessageWithMetadata): string | null {
  const resolvedModelId = readMetadata(message).resolvedModelId?.trim();
  if (!resolvedModelId) return null;
  return /^[a-z0-9][a-z0-9._-]*:\S+$/i.test(resolvedModelId) ? resolvedModelId : null;
}

/**
 * Read the server-owned course-scope-guardrail redirect flag attached to an
 * assistant message, so history restore can render the same redirect
 * affordance a live turn shows (e.g. suppressing regenerate/feedback
 * controls on a canned redirect message).
 */
export function courseScopeRedirectFromMessage(message: MessageWithMetadata): boolean {
  return readMetadata(message).courseScopeRedirect === true;
}

/**
 * Read whether the request that produced this assistant message used an auto
 * mode (#829: keyed by what was true at send time, not the live selector, so
 * this must survive a reload rather than default to false for every message).
 */
export function wasAutoRoutedFromMessage(message: MessageWithMetadata): boolean {
  return readMetadata(message).wasAutoRouted === true;
}

/** A message whose metadata slot now holds this module's fields alongside whatever it already carried. */
type WithChatMessageMetadata<T> = T & { metadata: JsonObject & ChatMessageMetadata };

/** Attach durable routing metadata without changing the message id or content. */
export function withResolvedModelMetadata<T extends object>(
  message: T,
  resolvedModelId: string,
  wasAutoRouted: boolean,
): WithChatMessageMetadata<T> {
  return {
    ...message,
    metadata: {
      ...existingMetadata(message),
      resolvedModelId,
      wasAutoRouted,
    },
  };
}

/** Tag a persisted assistant turn as a course-scope-guardrail redirect (analytics/UI). */
export function withCourseScopeRedirectMetadata<T extends object>(
  message: T,
): WithChatMessageMetadata<T> {
  return {
    ...message,
    metadata: {
      ...existingMetadata(message),
      courseScopeRedirect: true,
    },
  };
}
