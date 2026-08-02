import type { Prisma } from "@prisma/client";
import { resolvedModelIdFromMessage } from "~/lib/chat/chat-message-metadata";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Recursively flattens any stored message-content shape down to its display
 * text. The DB has accumulated several historical shapes due to past save bugs:
 *
 *   - clean string:           "**Hello**"
 *   - AI-SDK content array:    [{ type: "text", text: "**Hello**" }]
 *   - UIMessage parts:         { parts: [{ type: "text", text: "..." }] }
 *   - double-serialized:       a text part whose `.text` is the JSON string of
 *                              a whole message object (cascaded corruption)
 *
 * We unwrap all of them — including JSON re-serialized into a text field — so
 * restore and the read-only transcript always render the real markdown text
 * instead of "[object Object]", a blank bubble, or a raw JSON blob.
 */
export function messageToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    // Recover a message object that was JSON.stringified into a text field.
    const trimmed = value.trim();
    if (
      trimmed.startsWith("{") &&
      (trimmed.includes('"role"') || trimmed.includes('"parts"') || trimmed.includes('"content"'))
    ) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          return messageToText(parsed.content ?? parsed.parts ?? "");
        }
      } catch {
        // Not actually JSON — fall through and treat as plain text.
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .filter((p) => p.type === "text" || typeof p.text === "string")
      .map((p) => messageToText(p.text))
      .filter((t) => t.length > 0)
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return messageToText(obj.text);
    if (obj.content !== undefined && obj.content !== null) return messageToText(obj.content);
    if (obj.parts !== undefined && obj.parts !== null) return messageToText(obj.parts);
  }
  return "";
}

/**
 * Rehydrates a stored ChatMessage row back into an AI-SDK `Message` envelope so
 * the client can seed `useChat` (restore) or render a read-only transcript. The
 * DB stores the original JSON message; `messageId`/`role` are the escape hatch.
 *
 * Both `content` (string) and `parts` (text part) are normalized to the same
 * recovered text so ChatMessage renders consistent markdown regardless of which
 * field it reads first, and so legacy corrupted rows display correctly without a
 * data migration.
 */
export function reviveStoredMessage(record: {
  messageId: string;
  role: string;
  content: Prisma.JsonValue;
}): Record<string, unknown> {
  const parsed: Record<string, unknown> =
    record.content && typeof record.content === "object" && !Array.isArray(record.content)
      ? (record.content as Record<string, unknown>)
      : {};

  // Prefer an explicit non-empty string `content`; otherwise pull text out of
  // parts / array content / the whole stored value (handles every legacy shape).
  const source =
    isNonEmptyString(parsed.content)
      ? parsed.content
      : (parsed.parts ?? parsed.content ?? record.content);
  const text = messageToText(source);
  const role = isNonEmptyString(parsed.role) ? parsed.role : record.role;
  const resolvedModelId =
    role === "assistant" ? resolvedModelIdFromMessage(parsed) : null;
  const hitLongOutputCap =
    role === "assistant" &&
    parsed.metadata !== null &&
    typeof parsed.metadata === "object" &&
    !Array.isArray(parsed.metadata) &&
    (parsed.metadata as Record<string, unknown>).hitLongOutputCap === true;
  const metadata = {
    ...(resolvedModelId ? { resolvedModelId } : {}),
    ...(hitLongOutputCap ? { hitLongOutputCap: true } : {}),
  };

  return {
    id: isNonEmptyString(parsed.id) ? parsed.id : record.messageId,
    role,
    content: text,
    parts: [{ type: "text", text }],
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
