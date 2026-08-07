import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListChatSessions, mockGetChatMessages } = vi.hoisted(() => ({
  mockListChatSessions: vi.fn(),
  mockGetChatMessages: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    listChatSessions: mockListChatSessions,
    getChatMessages: mockGetChatMessages,
  },
}));

import {
  listChatSessions,
  loadSessionMessages,
  previewFromMessages,
} from '~/lib/student-chat-history';

describe('student-chat-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('propagates errors from listChatSessions instead of returning []', async () => {
    mockListChatSessions.mockRejectedValue(new Error('network down'));
    await expect(listChatSessions(42)).rejects.toThrow('network down');
  });

  it('maps listChatSessions rows on success', async () => {
    mockListChatSessions.mockResolvedValue([
      {
        id: 1,
        chatId: 'c1',
        mode: 'teach',
        modelId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ]);
    await expect(listChatSessions(1)).resolves.toEqual([
      {
        id: 1,
        chatId: 'c1',
        mode: 'teach',
        modelId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ]);
  });

  it('propagates errors from loadSessionMessages instead of returning []', async () => {
    mockGetChatMessages.mockRejectedValue(new Error('server error'));
    await expect(loadSessionMessages(1, 'chat-1')).rejects.toThrow('server error');
  });

  it('maps user and assistant messages from loadSessionMessages', async () => {
    mockGetChatMessages.mockResolvedValue({
      messages: [
        { messageId: 'm1', role: 'user', content: 'Hello' },
        { messageId: 'm2', role: 'assistant', content: 'Hi there' },
        { messageId: 'm3', role: 'system', content: 'ignored' },
      ],
    });
    await expect(loadSessionMessages(1, 'chat-1')).resolves.toEqual([
      { id: 'm1', role: 'user', content: 'Hello' },
      { id: 'm2', role: 'assistant', content: 'Hi there' },
    ]);
  });
});
