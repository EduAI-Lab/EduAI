export type ChatMessageMetadata = {
  resolvedModelId: string;
  wasAutoRouted: boolean;
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

/**
 * Read whether the request that produced this assistant message used an auto
 * mode (#829: keyed by what was true at send time, not the live selector, so
 * this must survive a reload rather than default to false for every message).
 */
export function wasAutoRoutedFromMessage(message: unknown): boolean {
  if (!isRecord(message) || !isRecord(message.metadata)) return false;
  return message.metadata.wasAutoRouted === true;
}

/** Attach durable routing metadata without changing the message id or content. */
export function withResolvedModelMetadata<T extends Record<string, unknown>>(
  message: T,
  resolvedModelId: string,
  wasAutoRouted: boolean,
): T & { metadata: Record<string, unknown> & ChatMessageMetadata } {
  return {
    ...message,
    metadata: {
      ...(isRecord(message.metadata) ? message.metadata : {}),
      resolvedModelId,
      wasAutoRouted,
    },
  };
}
