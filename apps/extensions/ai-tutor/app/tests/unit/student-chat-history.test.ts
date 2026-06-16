import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  deleteChatSession,
  listChatSessions,
  makeSessionId,
  previewFromMessages,
  upsertChatSession,
} from '~/lib/student-chat-history';

describe('student-chat-history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and lists sessions per activity', () => {
    const id = makeSessionId(42, 'teach');
    upsertChatSession({
      id,
      activityId: 42,
      tab: 'teach',
      preview: 'Hello world',
      updatedAt: new Date().toISOString(),
      messages: [{ id: '1', role: 'user', content: 'Hello world' }],
      chatId: 'chat-1',
    });

    const sessions = listChatSessions(42);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(id);
    expect(sessions[0]?.chatId).toBe('chat-1');
  });

  it('deletes a stored session', () => {
    const id = makeSessionId(7, 'guide');
    upsertChatSession({
      id,
      activityId: 7,
      tab: 'guide',
      preview: 'Test',
      updatedAt: new Date().toISOString(),
      messages: [],
      chatId: null,
    });

    deleteChatSession(id);
    expect(listChatSessions(7)).toHaveLength(0);
  });

  it('builds preview from the latest non-empty message', () => {
    expect(
      previewFromMessages([
        { id: '1', role: 'user', content: 'First' },
        { id: '2', role: 'assistant', content: '  Second reply  ' },
      ]),
    ).toBe('Second reply');
    expect(previewFromMessages([])).toBe('New conversation');
  });
});
