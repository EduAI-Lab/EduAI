/**
 * Per-process cancellation handles for active streamed chat turns.
 *
 * A browser abort does not always reach Core when Apache continues proxying the
 * upstream response. The client therefore sends this opaque, per-turn id when
 * the user presses Stop. Ids are UUIDs generated in the browser and exist only
 * for the lifetime of a live response.
 */
const activeChatCancellations = new Map<string, () => void>();

export function registerActiveChatCancellation(requestId: string, cancel: () => void): () => void {
  activeChatCancellations.set(requestId, cancel);
  return () => {
    if (activeChatCancellations.get(requestId) === cancel) {
      activeChatCancellations.delete(requestId);
    }
  };
}

export function cancelActiveChat(requestId: string): boolean {
  const cancel = activeChatCancellations.get(requestId);
  if (!cancel) return false;
  activeChatCancellations.delete(requestId);
  cancel();
  return true;
}

export function isValidActiveChatRequestId(requestId: unknown): requestId is string {
  return (
    typeof requestId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  );
}
