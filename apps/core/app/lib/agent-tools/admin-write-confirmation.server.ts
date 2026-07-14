import { hashRequestBody } from "~/lib/idempotency.server";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

type PendingPreview = {
  expiresAt: number;
};

/** actorId|toolName|payloadHash → expiry. Process-local; sufficient for single-node admin chat. */
const pendingPreviews = new Map<string, PendingPreview>();

function previewKey(actorId: string, toolName: string, payloadHash: string): string {
  return `${actorId}|${toolName}|${payloadHash}`;
}

export function hashWritePayload(payload: Record<string, unknown>): string {
  return hashRequestBody(payload);
}

/** Record a confirmed=false preview so a later confirmed=true can proceed. */
export function registerWritePreview(
  actorId: string,
  toolName: string,
  payload: Record<string, unknown>,
  ttlMs = DEFAULT_TTL_MS,
): void {
  const payloadHash = hashWritePayload(payload);
  pendingPreviews.set(previewKey(actorId, toolName, payloadHash), {
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Consume a one-time preview for the same actor/tool/payload.
 * Returns false if missing or expired (and clears stale entries).
 */
export function consumeWritePreview(
  actorId: string,
  toolName: string,
  payload: Record<string, unknown>,
): boolean {
  const key = previewKey(actorId, toolName, hashWritePayload(payload));
  const pending = pendingPreviews.get(key);
  if (!pending) return false;
  pendingPreviews.delete(key);
  return pending.expiresAt >= Date.now();
}

/** Test helper. */
export function resetWritePreviewsForTests(): void {
  pendingPreviews.clear();
}
