/**
 * Chat session helpers — API-backed (replaces localStorage).
 *
 * Sessions are persisted server-side in AiChatSession (ai-tutor DB) keyed by
 * the Core chatId. The client only holds messages in-memory during a session;
 * restoring a past session fetches messages from Core via the server proxy.
 */
import type { JsonObject, JsonValue } from "@eduai/types";

import api from "./api";
import type { ChatTab, ChatMessage } from "./student-chat-history-types";

export type { ChatTab, ChatMessage };

export type ApiChatSession = {
  id: number;
  chatId: string;
  mode: ChatTab;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listChatSessions(activityId: number): Promise<ApiChatSession[]> {
  const rows = await api.listChatSessions(activityId);
  return rows.map((r) => ({ ...r, mode: r.mode as ChatTab }));
}

export async function loadSessionMessages(
  activityId: number,
  chatId: string,
): Promise<ChatMessage[]> {
  const data = await api.getChatMessages(activityId, chatId);
  return data.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : extractText(m.content),
    }));
}

/** One `{ type: "text", text }` entry of an AI-SDK message's `parts` array. */
type TextPart = { type: "text"; text: string };

function isTextPart(part: JsonValue): part is JsonObject & TextPart {
  return (
    !!part &&
    typeof part === "object" &&
    !Array.isArray(part) &&
    part.type === "text" &&
    typeof part.text === "string"
  );
}

/**
 * Pull the display text out of a stored message body. Older rows hold a bare
 * string, newer ones an AI-SDK object with either a `content` string or a
 * `parts` array; anything else has no text to show.
 */
function extractText(content: JsonValue | undefined): string {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  if (typeof content.content === "string") return content.content;
  const parts = content.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join(" ");
}

export function previewFromMessages(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.content.trim());
  if (!last) return "New conversation";
  return last.content.trim().slice(0, 80);
}
