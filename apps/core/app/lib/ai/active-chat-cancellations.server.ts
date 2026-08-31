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

function cancellationKey(userId: string, requestId: string): string {
  return `${userId}|${requestId}`;
}

function prunePendingCancellations(now = Date.now()): void {
  for (const [key, expiresAt] of pendingChatCancellations) {
    if (expiresAt <= now) pendingChatCancellations.delete(key);
  }
}

function rememberPendingCancellation(key: string): void {
  const now = Date.now();
  prunePendingCancellations(now);
  if (pendingChatCancellations.size >= MAX_PENDING_CANCELLATIONS) {
    const oldest = pendingChatCancellations.keys().next().value;
    if (oldest) pendingChatCancellations.delete(oldest);
  }
  pendingChatCancellations.set(key, now + PENDING_CANCELLATION_TTL_MS);
}

export function registerActiveChatCancellation(
  userId: string,
  requestId: string,
  cancel: () => void,
): () => void {
  const key = cancellationKey(userId, requestId);
  prunePendingCancellations();
  if (pendingChatCancellations.delete(key)) {
    cancel();
    return () => {};
  }
  activeChatCancellations.set(key, cancel);
  return () => {
    if (activeChatCancellations.get(key) === cancel) {
      activeChatCancellations.delete(key);
    }
  };
}

export function cancelActiveChat(userId: string, requestId: string): boolean {
  const key = cancellationKey(userId, requestId);
  const cancel = activeChatCancellations.get(key);
  if (cancel) {
    activeChatCancellations.delete(key);
    cancel();
    return true;
  }
  if (isValidActiveChatRequestId(requestId)) rememberPendingCancellation(key);
  return false;
}

export function isValidActiveChatRequestId(requestId: string): boolean {
  return ACTIVE_CHAT_REQUEST_ID_RE.test(requestId);
}
