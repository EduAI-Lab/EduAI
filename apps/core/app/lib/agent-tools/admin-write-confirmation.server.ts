import { hashRequestBody } from "~/lib/idempotency.server";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

type PendingPreview = {
  expiresAt: number;
  /** Chat HTTP turn that registered the preview; confirm must use a later turn. */
  turnId: string | null;
};

/** actorId|toolName|payloadHash → expiry. Process-local; sufficient for single-node admin chat. */
const pendingPreviews = new Map<string, PendingPreview>();

function previewKey(actorId: string, toolName: string, payloadHash: string): string {
  return `${actorId}|${toolName}|${payloadHash}`;
}

export function hashWritePayload(payload: Record<string, unknown>): string {
  return hashRequestBody(payload);
}

function pruneExpiredWritePreviews(now = Date.now()): void {
  for (const [key, pending] of pendingPreviews) {
    if (pending.expiresAt < now) pendingPreviews.delete(key);
  }
}

/** Record a confirmed=false preview so a later confirmed=true can proceed. */
export function registerWritePreview(
  actorId: string,
  toolName: string,
  payload: Record<string, unknown>,
  ttlMs = DEFAULT_TTL_MS,
  turnId: string | null = null,
): void {
  pruneExpiredWritePreviews();
  const payloadHash = hashWritePayload(payload);
  pendingPreviews.set(previewKey(actorId, toolName, payloadHash), {
    expiresAt: Date.now() + ttlMs,
    turnId,
  });
}

export type ConsumeWritePreviewResult = "ok" | "missing" | "same_turn";

/**
 * Consume a one-time preview for the same actor/tool/payload.
 * Same-turn confirmation is rejected without consuming so a later user turn can still confirm.
 */
export function consumeWritePreview(
  actorId: string,
  toolName: string,
  payload: Record<string, unknown>,
  turnId: string | null = null,
): ConsumeWritePreviewResult {
  const key = previewKey(actorId, toolName, hashWritePayload(payload));
  const pending = pendingPreviews.get(key);
  if (!pending) return "missing";
  if (pending.expiresAt < Date.now()) {
    pendingPreviews.delete(key);
    return "missing";
  }
  // Preview bound to a chat turn cannot be confirmed in that same generation.
  if (pending.turnId != null && (turnId == null || turnId === pending.turnId)) {
    return "same_turn";
  }
  pendingPreviews.delete(key);
  return "ok";
}

/** Test helper. */
export function resetWritePreviewsForTests(): void {
  pendingPreviews.clear();
}
