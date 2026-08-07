/**
 * Chat session helpers — API-backed (replaces localStorage).
 *
 * Sessions are persisted server-side in AiChatSession (ai-tutor DB) keyed by
 * the Core chatId. The client only holds messages in-memory during a session;
 * restoring a past session fetches messages from Core via the server proxy.
 */
import api from './api';
import type { ChatTab, ChatMessage } from './student-chat-history-types';

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
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.messageId,
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : extractText(m.content),
    }));
}

function extractText(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const obj = content as Record<string, unknown>;
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.parts)) {
    return obj.parts
      .filter((p): p is { type: string; text: string } => !!p && typeof p === 'object' && (p as any).type === 'text')
      .map((p) => p.text)
      .join(' ');
  }
  return '';
}

export function previewFromMessages(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.content.trim());
  if (!last) return 'New conversation';
  return last.content.trim().slice(0, 80);
}
