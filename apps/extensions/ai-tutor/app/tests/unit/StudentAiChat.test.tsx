/**
 * Covers Week 10 QA-audit fixes in StudentAiChat.tsx:
 *   - #998: sendChat lacks an in-flight guard, allowing duplicate concurrent
 *     chat requests (both the manual submit path and the imperative
 *     sendGuidePrompt handle used by the parent's "Guide me" button).
 *   - #999: no stop-generating control and no request timeout in the chat
 *     send path.
 *   - #1002: chat input textarea stays enabled while a response is loading.
 *
 * And Week 11 coverage (issue #1003):
 *   - Tab switching between modes
 *   - API key validation dialog flow
 *   - Send/receive round trip
 *   - ChatId threading across consecutive messages
 *   - History restoration from a saved session
 */
import { createRef } from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StudentAiChat, { type StudentAiChatHandle } from '~/components/StudentAiChat';
import { loadSessionMessages, type ApiChatSession } from '~/lib/student-chat-history';
import type { Activity } from '~/lib/types';

// ── useApiKeys: controllable mock ──────────────────────────────────────────
const { mockGetKey, mockSetKey, mockValidateKey } = vi.hoisted(() => ({
  mockGetKey: vi.fn((): string | undefined => 'test-provider-key'),
  mockSetKey: vi.fn(),
  mockValidateKey: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('~/hooks/use-api-keys', () => ({
  useApiKeys: () => ({
    loaded: true,
    getKey: mockGetKey,
    setKey: mockSetKey,
    validateKey: mockValidateKey,
  }),
}));

// ── StudentChatHistoryPanel: capture onSelect for restoration tests ────────
let capturedHistoryOnSelect: ((session: ApiChatSession) => void) | undefined;

vi.mock('~/components/StudentChatHistoryPanel', () => ({
  StudentChatHistoryPanel: ({ onSelect }: { onSelect: (s: ApiChatSession) => void }) => {
    capturedHistoryOnSelect = onSelect;
    return null;
  },
}));

vi.mock('~/lib/student-chat-history', () => ({
  loadSessionMessages: vi.fn().mockResolvedValue([]),
}));

// ── api: hoisted mocks ────────────────────────────────────────────────────
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
    listAiModels: vi.fn().mockResolvedValue([
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

// ── Fixtures ──────────────────────────────────────────────────────────────
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

const MULTI_MODE_ACTIVITY: Activity = {
  ...ACTIVITY,
  enableTeachMode: true,
  enableGuideMode: true,
};

/** A pending guide-message call the test controls, honoring AbortSignal like the real api.ts. */
function deferredGuideCall() {
  let resolve!: (value: { message: string; chatId?: string | null }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ message: string; chatId?: string | null }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  sendGuideMessage.mockImplementationOnce((_activityId: unknown, _params: unknown, signal?: AbortSignal) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
    return promise;
  });
  return { resolve, reject };
}

function renderChat(
  ref?: React.Ref<StudentAiChatHandle>,
  activity: Activity = ACTIVITY,
) {
  return render(
    <MemoryRouter>
      <StudentAiChat
        ref={ref}
        activity={activity}
        isUserReady
        knowledgeLevel="beginner"
        onSelectKnowledgeLevel={vi.fn()}
        onAdjustKnowledgeLevel={vi.fn()}
        topicOptions={[]}
        currentTopicId={null}
        onSelectTopic={vi.fn()}
        studentAnswer={null}
      />
    </MemoryRouter>,
  );
}

async function typeAndSend(text: string, placeholder = 'Describe where you need guidance…') {
  const textarea = screen.getByPlaceholderText(placeholder);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /send message/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetKey.mockReturnValue('test-provider-key');
  mockValidateKey.mockResolvedValue({ valid: true });
  listSuggestedPrompts.mockResolvedValue([]);
  listAiModels.mockResolvedValue([
    { id: 'm1', modelId: 'google:gemini-2.5-flash', modelName: 'Gemini 2.5 Flash' },
  ]);
  vi.mocked(loadSessionMessages).mockResolvedValue([]);
  capturedHistoryOnSelect = undefined;
});

// ── #998 ──────────────────────────────────────────────────────────────────

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

// ── #999 ──────────────────────────────────────────────────────────────────

describe('StudentAiChat — stop control and timeout (#999)', () => {
  it('shows a Stop button while loading and aborts the request without an error bubble on click', async () => {
    deferredGuideCall();
    renderChat();

    await typeAndSend('I need a hint');
    const stopBtn = await screen.findByRole('button', { name: /stop generating/i });

    fireEvent.click(stopBtn);

    await waitFor(() => expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument());
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
      expect(screen.getByText('That took too long to respond. Please try again.')).toBeInTheDocument(),
    );
  });
});

// ── #1002 ─────────────────────────────────────────────────────────────────

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

// ── #1003: tab switching ──────────────────────────────────────────────────

describe('StudentAiChat — tab switching (#1003)', () => {
  it('renders mode labels when multiple modes are enabled', () => {
    renderChat(undefined, MULTI_MODE_ACTIVITY);
    expect(screen.getByText('Teach me')).toBeInTheDocument();
    expect(screen.getByText('Guide me')).toBeInTheDocument();
  });

  it('switches the active mode when a tab option is clicked', async () => {
    renderChat(undefined, MULTI_MODE_ACTIVITY);
    expect(screen.getByPlaceholderText('Describe where you need guidance…')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Teach me'));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Ask about the topic…')).toBeInTheDocument(),
    );
  });

  it('maintains independent message history per tab', async () => {
    sendTeachMessage.mockResolvedValue({ message: 'Teach reply', chatId: 'chat-teach' });
    sendGuideMessage.mockResolvedValue({ message: 'Guide reply', chatId: 'chat-guide' });
    renderChat(undefined, MULTI_MODE_ACTIVITY);

    // Send on Guide tab (default)
    await typeAndSend('guide question', 'Describe where you need guidance…');
    await waitFor(() => screen.getByText('Guide reply'));

    // Switch to Teach — guide messages must not be visible
    fireEvent.click(screen.getByText('Teach me'));
    await waitFor(() => expect(screen.queryByText('Guide reply')).not.toBeInTheDocument());

    // Send on Teach tab
    await typeAndSend('teach question', 'Ask about the topic…');
    await waitFor(() => screen.getByText('Teach reply'));

    // Switch back to Guide — teach messages gone, guide messages restored
    fireEvent.click(screen.getByText('Guide me'));
    await waitFor(() => expect(screen.getByText('Guide reply')).toBeInTheDocument());
    expect(screen.queryByText('Teach reply')).not.toBeInTheDocument();
  });
});

// ── #1003: API key validation ─────────────────────────────────────────────

describe('StudentAiChat — API key validation dialog (#1003)', () => {
  it('shows the "Add API key" CTA when no provider key is configured', async () => {
    mockGetKey.mockReturnValue(undefined);
    renderChat();
    expect(await screen.findByRole('button', { name: /add api key/i })).toBeInTheDocument();
  });

  it('opens the API key dialog when "Add API key" is clicked', async () => {
    mockGetKey.mockReturnValue(undefined);
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: /add api key/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the Save button disabled when the key input is empty', async () => {
    mockGetKey.mockReturnValue(undefined);
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: /add api key/i }));
    expect(await screen.findByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('shows a validation error when the key is rejected by the provider', async () => {
    mockGetKey.mockReturnValue(undefined);
    mockValidateKey.mockResolvedValue({ valid: false, error: 'Invalid API key' });
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: /add api key/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter your.*api key/i), {
      target: { value: 'bad-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText('Invalid API key')).toBeInTheDocument());
  });

  it('calls setKey and closes the dialog when a valid key is saved', async () => {
    mockGetKey.mockReturnValue(undefined);
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: /add api key/i }));
    fireEvent.change(await screen.findByPlaceholderText(/enter your.*api key/i), {
      target: { value: 'valid-key-12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockSetKey).toHaveBeenCalledWith('google', 'valid-key-12345'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// ── #1003: send/receive round trip ────────────────────────────────────────

describe('StudentAiChat — send/receive round trip (#1003)', () => {
  it('appends the user message immediately and the assistant reply on resolution', async () => {
    sendGuideMessage.mockResolvedValue({ message: 'Here is a hint.', chatId: null });
    renderChat();

    await typeAndSend('Help me please');

    expect(screen.getByText('Help me please')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Here is a hint.')).toBeInTheDocument());
  });

  it('clears the input field after sending', async () => {
    sendGuideMessage.mockResolvedValue({ message: 'Reply', chatId: null });
    renderChat();

    const textarea = screen.getByPlaceholderText('Describe where you need guidance…');
    fireEvent.change(textarea, { target: { value: 'My question' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('appends a generic error bubble when the API call fails unexpectedly', async () => {
    sendGuideMessage.mockRejectedValue(new Error('network error'));
    renderChat();

    await typeAndSend('My question');

    await waitFor(() =>
      expect(
        screen.getByText('AI study buddy not available right now. Please try again later.'),
      ).toBeInTheDocument(),
    );
  });
});

// ── #1003: chatId threading ───────────────────────────────────────────────

describe('StudentAiChat — chatId threading (#1003)', () => {
  it('passes the chatId from the first response into the second request', async () => {
    sendGuideMessage
      .mockResolvedValueOnce({ message: 'First reply', chatId: 'thread-abc' })
      .mockResolvedValueOnce({ message: 'Second reply', chatId: 'thread-abc' });
    renderChat();

    await typeAndSend('First question');
    await waitFor(() => screen.getByText('First reply'));

    await typeAndSend('Follow-up question');
    await waitFor(() => screen.getByText('Second reply'));

    expect(sendGuideMessage.mock.calls[1][1]).toMatchObject({ chatId: 'thread-abc' });
  });
});

// ── #1003: history restoration ────────────────────────────────────────────

describe('StudentAiChat — history restoration (#1003)', () => {
  it('loads messages and renders them when a history session is selected', async () => {
    vi.mocked(loadSessionMessages).mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Old question' },
      { id: 'm2', role: 'assistant', content: 'Old answer' },
    ]);
    renderChat();

    const session: ApiChatSession = {
      id: 5,
      chatId: 'chat-restored',
      mode: 'guide',
      modelId: 'google:gemini-2.5-flash',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await act(async () => {
      capturedHistoryOnSelect?.(session);
    });

    await waitFor(() =>
      expect(loadSessionMessages).toHaveBeenCalledWith(ACTIVITY.id, 'chat-restored'),
    );
    await waitFor(() => expect(screen.getByText('Old answer')).toBeInTheDocument());
  });
});
