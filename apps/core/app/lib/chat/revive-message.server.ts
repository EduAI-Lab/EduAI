import type { Prisma } from "@prisma/client";
import type { Message } from "ai";
import {
  courseScopeRedirectFromMessage,
  resolvedModelIdFromMessage,
  wasAutoRoutedFromMessage,
} from "~/lib/chat/chat-message-metadata";
import { jsonObjectSchema, jsonValueSchema, parseJsonText } from "~/lib/json-value";
import type { JsonObject, JsonValue } from "~/lib/json-value";

/** Per-message metadata Core persists alongside a stored assistant turn. */
export type StoredChatMessageMetadata = {
  resolvedModelId?: string;
  wasAutoRouted?: boolean;
  hitLongOutputCap?: boolean;
  courseScopeRedirect?: boolean;
};

/**
 * A stored message revived for the client.
 *
 * AI-SDK's `Message` has no `metadata` field, so the two are named together
 * here rather than being re-asserted at every render site.
 */
export type StoredChatMessage = Message & {
  metadata?: StoredChatMessageMetadata;
};

/** A JSON object, as opposed to a scalar or an array. */
const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Decodes a JSON object from text, or `null` if the text is not one. */
function parseJsonObject(text: string): JsonObject | null {
  const decoded = jsonObjectSchema.safeParse(parseJsonText(text));
  return decoded.success ? decoded.data : null;
}

const isNonEmptyString = (value: JsonValue | undefined): value is string =>
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
export function messageToText(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    // Recover a message object that was JSON.stringified into a text field.
    const trimmed = value.trim();
    if (
      trimmed.startsWith("{") &&
      (trimmed.includes('"role"') || trimmed.includes('"parts"') || trimmed.includes('"content"'))
    ) {
      const parsed = parseJsonObject(trimmed);
      if (parsed) return messageToText(parsed.content ?? parsed.parts ?? "");
      // Not actually a JSON object — fall through and treat as plain text.
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter(isJsonObject)
      .filter((p) => p.type === "text" || typeof p.text === "string")
      .map((p) => messageToText(p.text))
      .filter((t) => t.length > 0)
      .join("\n");
  }
  if (isJsonObject(value)) {
    if (typeof value.text === "string") return messageToText(value.text);
    if (value.content !== undefined && value.content !== null) return messageToText(value.content);
    if (value.parts !== undefined && value.parts !== null) return messageToText(value.parts);
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
}): StoredChatMessage {
  // The DB column is `Json`, so the stored value is decoded here once and every
  // reader below works off the decoded shape rather than re-asserting the row.
  const storedContent = jsonValueSchema.safeParse(record.content);
  const content: JsonValue = storedContent.success ? storedContent.data : null;
  const parsed: JsonObject = isJsonObject(content) ? content : {};

  // Prefer an explicit non-empty string `content`; otherwise pull text out of
  // parts / array content / the whole stored value (handles every legacy shape).
  const source = isNonEmptyString(parsed.content)
    ? parsed.content
    : (parsed.parts ?? parsed.content ?? content);
  const text = messageToText(source);
  const role = isNonEmptyString(parsed.role) ? parsed.role : record.role;
  const resolvedModelId = role === "assistant" ? resolvedModelIdFromMessage(parsed) : null;
  const wasAutoRouted = role === "assistant" && wasAutoRoutedFromMessage(parsed);
  const courseScopeRedirect = role === "assistant" ? courseScopeRedirectFromMessage(parsed) : false;
  // `hitLongOutputCap` is owned by this module rather than chat-message-metadata:
  // it is only ever read back out of a stored row, never written to a live turn.
  const hitLongOutputCap =
    role === "assistant" &&
    isJsonObject(parsed.metadata) &&
    parsed.metadata.hitLongOutputCap === true;
  const metadata: StoredChatMessageMetadata = {};
  if (resolvedModelId) {
    metadata.resolvedModelId = resolvedModelId;
    metadata.wasAutoRouted = wasAutoRouted;
  }
  if (hitLongOutputCap) metadata.hitLongOutputCap = true;
  if (courseScopeRedirect) metadata.courseScopeRedirect = true;

  const revived: StoredChatMessage = {
    id: isNonEmptyString(parsed.id) ? parsed.id : record.messageId,
    // SAFETY: `role` is whatever the row stored, and rows predate the current
    // role union. The value is only ever compared or rendered, never used to
    // pick a code path that assumes a narrower role, so preserving the stored
    // string is safer here than coercing an unrecognized one to a valid role.
    role: role as StoredChatMessage["role"],
    content: text,
    parts: [{ type: "text", text }],
  };
  // A turn with nothing worth recording carries no `metadata` key at all, so a
  // restored transcript matches the shape a fresh turn produces.
  if (Object.keys(metadata).length > 0) revived.metadata = metadata;
  return revived;
}
