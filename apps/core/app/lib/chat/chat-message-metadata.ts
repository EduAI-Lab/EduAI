export type ChatMessageMetadata = {
  resolvedModelId?: string;
  courseScopeRedirect?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Read the server-owned model metadata attached to an assistant message.
 * Registry ids have the form `provider:model`; reject malformed stored JSON
 * rather than letting arbitrary metadata become a user-facing label.
 */
export function resolvedModelIdFromMessage(message: unknown): string | null {
  if (!isRecord(message) || !isRecord(message.metadata)) return null;

  const value = message.metadata.resolvedModelId;
  if (typeof value !== "string") return null;

  const resolvedModelId = value.trim();
  return /^[a-z0-9][a-z0-9._-]*:\S+$/i.test(resolvedModelId)
    ? resolvedModelId
    : null;
}

/** Attach durable routing metadata without changing the message id or content. */
export function withResolvedModelMetadata<T extends Record<string, unknown>>(
  message: T,
  resolvedModelId: string,
): T & { metadata: Record<string, unknown> & ChatMessageMetadata } {
  return {
    ...message,
    metadata: {
      ...(isRecord(message.metadata) ? message.metadata : {}),
      resolvedModelId,
    },
  };
}

/** Tag a persisted assistant turn as a course-scope-guardrail redirect (analytics/UI). */
export function withCourseScopeRedirectMetadata<T extends Record<string, unknown>>(
  message: T,
): T & { metadata: Record<string, unknown> & ChatMessageMetadata } {
  return {
    ...message,
    metadata: {
      ...(isRecord(message.metadata) ? message.metadata : {}),
      courseScopeRedirect: true,
    },
  };
}
