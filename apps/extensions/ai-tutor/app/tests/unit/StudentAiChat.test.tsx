/**
 * Covers three Week 10 QA-audit fixes in StudentAiChat.tsx:
 *   - #998: sendChat lacks an in-flight guard, allowing duplicate concurrent
 *     chat requests (both the manual submit path and the imperative
 *     sendGuidePrompt handle used by the parent's "Guide me" button).
 *   - #999: no stop-generating control and no request timeout in the chat
 *     send path.
 *   - #1002: chat input textarea stays enabled while a response is loading.
 * Plus the #1000 (PR #1023) session-restore error paths:
 *   - a failed restore surfaces an assistant error message and drops the
 *     failed session's chatId instead of leaving it sticky;
 *   - stale restore completions (after "New chat" or a newer restore) are
 *     ignored instead of clobbering the tab's current state.
 */
import { act, createRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudentAiChat, { type StudentAiChatHandle } from '~/components/StudentAiChat';
import type { ApiChatSession } from '~/lib/student-chat-history';
import type { Activity } from '~/lib/types';

type HistoryPanelProps = {
  onSelect: (session: ApiChatSession) => void;
  onNewChat: () => void;
};

vi.mock('~/hooks/use-api-keys', () => ({
  useApiKeys: () => ({
    loaded: true,
    getKey: () => 'test-provider-key',
    setKey: vi.fn(),
    validateKey: vi.fn(),
  }),
}));

const { historyPanelProps, loadSessionMessages } = vi.hoisted(() => ({
  // Captures the live props StudentAiChat passes to the (mocked) history
  // panel so tests can trigger onSelect (session restore) directly.
  historyPanelProps: { current: null as unknown },
  loadSessionMessages: vi.fn(),
}));

vi.mock('~/components/StudentChatHistoryPanel', () => ({
  StudentChatHistoryPanel: (props: unknown) => {
    historyPanelProps.current = props;
    return null;
  },
}));

vi.mock('~/lib/student-chat-history', () => ({
  loadSessionMessages,
}));

function restoreSession(session: ApiChatSession) {
  (historyPanelProps.current as HistoryPanelProps).onSelect(session);
}

const {
  sendGuideMessage,
  sendTeachMessage,
  sendCustomMessage,
  listSuggestedPrompts,
  listAiModels,
  ApiTimeoutError,
} = vi.hoisted(() => {
  class ApiTimeoutError extends Error {
    constructor(message = 'Request timed out') {
      super(message);
      this.name = 'ApiTimeoutError';
    }
  }
  return {
    sendGuideMessage: vi.fn(),
    sendTeachMessage: vi.fn(),
    sendCustomMessage: vi.fn(),
    listSuggestedPrompts: vi.fn().mockResolvedValue([]),
    listAiModels: vi
      .fn()
      .mockResolvedValue([
        { id: 'm1', modelId: 'google:gemini-2.5-flash', modelName: 'Gemini 2.5 Flash' },
      ]),
    ApiTimeoutError,
  };
});

vi.mock('~/lib/api', () => ({
  ApiTimeoutError,
  default: {
    listSuggestedPrompts,
    listAiModels,
    sendGuideMessage,
    sendTeachMessage,
    sendCustomMessage,
  },
}));

const ACTIVITY: Activity = {
  id: 1,
  title: 'Recursion practice',
  instructionsMd: '',
  position: 0,
  question: 'What is recursion?',
  type: 'SHORT_TEXT',
  options: null,
  hints: [],
  mainTopic: null,
  secondaryTopics: [],
  enableTeachMode: false,
  enableGuideMode: true,
  enableCustomMode: false,
  customPrompt: null,
  customPromptTitle: null,
};

/** A pending guide-message call the test controls, honoring AbortSignal like the real api.ts. */
function deferredGuideCall() {
  let resolve!: (value: { message: string; chatId?: string | null }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ message: string; chatId?: string | null }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  sendGuideMessage.mockImplementationOnce((_activityId, _params, signal?: AbortSignal) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
    return promise;
  });
  return { resolve, reject };
}

function renderChat(ref?: React.Ref<StudentAiChatHandle>) {
  return render(
    <StudentAiChat
      ref={ref}
      activity={ACTIVITY}
      isUserReady
      knowledgeLevel="beginner"
      onSelectKnowledgeLevel={vi.fn()}
      onAdjustKnowledgeLevel={vi.fn()}
      topicOptions={[]}
      currentTopicId={null}
      onSelectTopic={vi.fn()}
      studentAnswer={null}
    />,
  );
}

async function typeAndSend(text: string) {
  const textarea = screen.getByPlaceholderText('Describe where you need guidance…');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /send message/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listSuggestedPrompts.mockResolvedValue([]);
  listAiModels.mockResolvedValue([
    { id: 'm1', modelId: 'google:gemini-2.5-flash', modelName: 'Gemini 2.5 Flash' },
  ]);
  loadSessionMessages.mockResolvedValue([]);
});

describe('StudentAiChat — in-flight guard (#998)', () => {
  it('does not fire a second request while one is already loading (manual submit)', async () => {
    const { resolve } = deferredGuideCall();
    renderChat();

    await typeAndSend('I need a hint');
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    // Second Enter/click attempt while still loading — button is now Stop, not Send.
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
    expect(sendGuideMessage).toHaveBeenCalledTimes(1);

    resolve({ message: 'Here is a hint.' });
    await waitFor(() => screen.getByText('Here is a hint.'));
  });

  it('sendGuidePrompt (parent "Guide me" trigger) is a no-op while a request is already in flight', async () => {
    deferredGuideCall();
    const ref = createRef<StudentAiChatHandle>();
    renderChat(ref);

    ref.current?.sendGuidePrompt();
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    // A second imperative call while the first is still pending must be dropped.
    ref.current?.sendGuidePrompt();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendGuideMessage).toHaveBeenCalledTimes(1);
  });
});

describe('StudentAiChat — stop control and timeout (#999)', () => {
  it('shows a Stop button while loading and aborts the request without an error bubble on click', async () => {
    deferredGuideCall();
    renderChat();

    await typeAndSend('I need a hint');
    const stopBtn = await screen.findByRole('button', { name: /stop generating/i });

    fireEvent.click(stopBtn);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument(),
    );
    // A user-cancelled turn should not append an error bubble.
    expect(screen.queryByText(/not available right now/i)).not.toBeInTheDocument();
  });

  it('shows a friendly message when the request times out', async () => {
    const { reject } = deferredGuideCall();
    renderChat();

    await typeAndSend('I need a hint');
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));

    reject(new ApiTimeoutError());

    await waitFor(() =>
      expect(
        screen.getByText('That took too long to respond. Please try again.'),
      ).toBeInTheDocument(),
    );
  });
});

describe('StudentAiChat — textarea disabled while loading (#1002)', () => {
  it('disables the textarea once a request is in flight', async () => {
    deferredGuideCall();
    renderChat();

    const textarea = screen.getByPlaceholderText('Describe where you need guidance…');
    expect(textarea).not.toBeDisabled();

    await typeAndSend('I need a hint');

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Describe where you need guidance…')).toBeDisabled(),
    );
  });
});

/** A pending loadSessionMessages call the test resolves/rejects on demand. */
function deferredRestoreCall() {
  type RestoredMessages = { id: string; role: 'user' | 'assistant'; content: string }[];
  let resolve!: (value: RestoredMessages) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<RestoredMessages>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  loadSessionMessages.mockReturnValueOnce(promise);
  return { resolve, reject };
}

function makeSession(chatId: string): ApiChatSession {
  return {
    id: 1,
    chatId,
    mode: 'guide',
    modelId: null,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  };
}

const RESTORE_ERROR_TEXT = /Couldn't load this conversation/i;

describe('StudentAiChat — session restore failures (#1000 / PR #1023)', () => {
  it('shows an error message on restore failure and drops the failed chatId from the next send', async () => {
    loadSessionMessages.mockRejectedValueOnce(new Error('server error'));
    renderChat();

    act(() => restoreSession(makeSession('failed-session')));

    await waitFor(() => expect(screen.getByText(RESTORE_ERROR_TEXT)).toBeInTheDocument());

    // The failed session's chatId must not be threaded into the next send —
    // the user would otherwise chat into a history that never loaded.
    const { resolve } = deferredGuideCall();
    await typeAndSend('I need a hint');
    await waitFor(() => expect(sendGuideMessage).toHaveBeenCalledTimes(1));
    expect(sendGuideMessage.mock.calls[0][1].chatId).toBeNull();
    resolve({ message: 'Here is a hint.' });
    await waitFor(() => screen.getByText('Here is a hint.'));
  });

  it('ignores a stale restore failure after the user starts a new chat', async () => {
    const { reject } = deferredRestoreCall();
    renderChat();

    act(() => restoreSession(makeSession('slow-session')));

    // User abandons the pending restore with "New chat", then the old
    // request fails — the failure must not leak into the fresh chat.
    fireEvent.click(await screen.findByRole('button', { name: /new chat/i }));
    await act(async () => {
      reject(new Error('too late'));
    });

    expect(screen.queryByText(RESTORE_ERROR_TEXT)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe where you need guidance…')).not.toBeDisabled();
  });

  it('ignores a stale restore failure after a newer restore already succeeded', async () => {
    const { reject: rejectFirst } = deferredRestoreCall();
    loadSessionMessages.mockResolvedValueOnce([
      { id: 'm1', role: 'assistant', content: 'Restored conversation B' },
    ]);
    renderChat();

    act(() => restoreSession(makeSession('session-a')));
    act(() => restoreSession(makeSession('session-b')));

    await waitFor(() => expect(screen.getByText('Restored conversation B')).toBeInTheDocument());

    // Session A's late failure must not clear B's restored messages.
    await act(async () => {
      rejectFirst(new Error('late failure for A'));
    });

    expect(screen.getByText('Restored conversation B')).toBeInTheDocument();
    expect(screen.queryByText(RESTORE_ERROR_TEXT)).not.toBeInTheDocument();
  });
});
