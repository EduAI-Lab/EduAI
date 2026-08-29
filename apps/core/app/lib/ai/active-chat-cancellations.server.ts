/**
 * Per-process cancellation handles for active streamed chat turns.
 *
 * A browser abort does not always reach Core when Apache continues proxying the
 * upstream response. The client therefore sends this opaque, per-turn id when
 * the user presses Stop. Ids are UUIDs generated in the browser and exist only
 * for the lifetime of a live response.
 */
const activeChatCancellations = new Map<string, () => void>();
const pendingChatCancellations = new Map<string, number>();
const PENDING_CANCELLATION_TTL_MS = 30_000;
const MAX_PENDING_CANCELLATIONS = 1_024;
const ACTIVE_CHAT_REQUEST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function prunePendingCancellations(now = Date.now()): void {
  for (const [requestId, expiresAt] of pendingChatCancellations) {
    if (expiresAt <= now) pendingChatCancellations.delete(requestId);
  }
}

function rememberPendingCancellation(requestId: string): void {
  const now = Date.now();
  prunePendingCancellations(now);
  if (pendingChatCancellations.size >= MAX_PENDING_CANCELLATIONS) {
    const oldest = pendingChatCancellations.keys().next().value;
    if (oldest) pendingChatCancellations.delete(oldest);
  }
  pendingChatCancellations.set(requestId, now + PENDING_CANCELLATION_TTL_MS);
}

export function registerActiveChatCancellation(requestId: string, cancel: () => void): () => void {
  prunePendingCancellations();
  if (pendingChatCancellations.delete(requestId)) {
    cancel();
    return () => {};
  }
  activeChatCancellations.set(requestId, cancel);
  return () => {
    if (activeChatCancellations.get(requestId) === cancel) {
      activeChatCancellations.delete(requestId);
    }
  };
}

export function cancelActiveChat(requestId: string): boolean {
  const cancel = activeChatCancellations.get(requestId);
  if (cancel) {
    activeChatCancellations.delete(requestId);
    cancel();
    return true;
  }
  if (isValidActiveChatRequestId(requestId)) rememberPendingCancellation(requestId);
  return false;
}

export function isValidActiveChatRequestId(requestId: string): boolean {
  return ACTIVE_CHAT_REQUEST_ID_RE.test(requestId);
}
