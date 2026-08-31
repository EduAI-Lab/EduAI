import { randomUUID } from "node:crypto";
import { hashRequestBody } from "~/lib/idempotency.server";
import type { ToolInput } from "./tool-input";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

type PendingPreview = {
  confirmationCode: string;
  expiresAt: number;
  turnId: string;
};

export type WritePreviewBinding = {
  actorId: string;
  chatId: string;
  toolName: string;
  payload: ToolInput;
};

type RegisterWritePreviewOptions = WritePreviewBinding & {
  turnId: string;
  ttlMs?: number;
};

type ConsumeWritePreviewOptions = WritePreviewBinding & {
  turnId: string;
  latestUserMessage: string | null;
};

export type WritePreview = Pick<PendingPreview, "confirmationCode" | "expiresAt">;

export type ConsumeWritePreviewResult =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "same_turn"; preview: WritePreview }
  | { kind: "message_mismatch"; preview: WritePreview };

/** actorId|chatId|toolName|payloadHash → one-time code. Process-local for single-node chat. */
const pendingPreviews = new Map<string, PendingPreview>();

function previewKey({ actorId, chatId, toolName, payload }: WritePreviewBinding): string {
  return `${actorId}|${chatId}|${toolName}|${hashWritePayload(payload)}`;
}

export function hashWritePayload(payload: ToolInput): string {
  return hashRequestBody(payload);
}

function pruneExpiredWritePreviews(now = Date.now()): void {
  for (const [key, pending] of pendingPreviews) {
    if (pending.expiresAt < now) pendingPreviews.delete(key);
  }
}

/** Register a preview or return the still-active code for the same exact write. */
export function registerWritePreview({
  turnId,
  ttlMs = DEFAULT_TTL_MS,
  ...binding
}: RegisterWritePreviewOptions): WritePreview {
  pruneExpiredWritePreviews();
  const key = previewKey(binding);
  const existing = pendingPreviews.get(key);
  if (existing) {
    return existing;
  }

  const preview = {
    confirmationCode: `ADMIN-WRITE-${randomUUID()}`,
    expiresAt: Date.now() + ttlMs,
    turnId,
  };
  pendingPreviews.set(key, preview);
  return preview;
}

/**
 * Consume only when a later raw user message is exactly the server-issued code.
 * Rejections leave the preview active so an unrelated turn does not cancel it.
 */
export function consumeWritePreview({
  turnId,
  latestUserMessage,
  ...binding
}: ConsumeWritePreviewOptions): ConsumeWritePreviewResult {
  const key = previewKey(binding);
  const pending = pendingPreviews.get(key);
  if (!pending) return { kind: "missing" };
  if (pending.expiresAt < Date.now()) {
    pendingPreviews.delete(key);
    return { kind: "missing" };
  }
  if (turnId === pending.turnId) {
    return { kind: "same_turn", preview: pending };
  }
  if (latestUserMessage !== pending.confirmationCode) {
    return { kind: "message_mismatch", preview: pending };
  }
  pendingPreviews.delete(key);
  return { kind: "ok" };
}

/** Test helper. */
export function resetWritePreviewsForTests(): void {
  pendingPreviews.clear();
}
