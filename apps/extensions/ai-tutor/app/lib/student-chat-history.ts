import type { ChatTab, ChatMessage } from './student-chat-history-types';

export type { ChatTab, ChatMessage };

export type StoredChatSession = {
  id: string;
  activityId: number;
  tab: ChatTab;
  preview: string;
  updatedAt: string;
  messages: ChatMessage[];
  chatId: string | null;
};

const STORAGE_KEY = 'ai-tutor:chat-history';

function readStore(): StoredChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredChatSession[]) : [];
  } catch {
    return [];
  }
}

function writeStore(sessions: StoredChatSession[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // quota / private mode — ignore
  }
}

export function listChatSessions(activityId: number): StoredChatSession[] {
  return readStore()
    .filter((s) => s.activityId === activityId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function upsertChatSession(session: StoredChatSession) {
  const all = readStore().filter((s) => s.id !== session.id);
  writeStore([session, ...all].slice(0, 50));
}

export function deleteChatSession(id: string) {
  writeStore(readStore().filter((s) => s.id !== id));
}

export function makeSessionId(activityId: number, tab: ChatTab): string {
  return `${activityId}:${tab}:${Date.now()}`;
}

export function previewFromMessages(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.content.trim());
  if (!last) return 'New conversation';
  return last.content.trim().slice(0, 80);
}
