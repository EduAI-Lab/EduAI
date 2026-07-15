/**
 * Week 11 #1003 coverage for StudentChatHistoryPanel (loading/empty/list/
 * interactions) plus #1000 (PR #1023) load-error paths:
 *   - failed session-list load renders "Couldn't load history" + Retry
 *   - out-of-order completions are ignored so a stale rejection can't
 *     overwrite the newest request's result.
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StudentChatHistoryPanel } from '~/components/StudentChatHistoryPanel';
import type { ApiChatSession } from '~/lib/student-chat-history';

const { listChatSessions } = vi.hoisted(() => ({
  listChatSessions: vi.fn(),
}));

vi.mock('~/lib/student-chat-history', () => ({
  listChatSessions,
}));

const NOW = Date.now();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const SESSION_GUIDE: ApiChatSession = {
  id: 1,
  chatId: 'chat-aaa',
  mode: 'guide',
  modelId: 'google:gemini-2.5-flash',
  createdAt: new Date(NOW - 30 * 60_000).toISOString(),
  updatedAt: new Date(NOW - 2 * 60_000).toISOString(), // 2 m ago
};

const SESSION_TEACH: ApiChatSession = {
  id: 2,
  chatId: 'chat-bbb',
  mode: 'teach',
  modelId: 'google:gemini-2.5-flash',
  createdAt: new Date(NOW - 3 * 3600_000).toISOString(),
  updatedAt: new Date(NOW - 90 * 60_000).toISOString(), // 1 h ago
};

type PanelProps = React.ComponentProps<typeof StudentChatHistoryPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    open: true,
    onOpenChange: vi.fn(),
    activityId: 1,
    activeChatId: null,
    onSelect: vi.fn(),
    onNewChat: vi.fn(),
    ...overrides,
  };
  return { ...render(<StudentChatHistoryPanel {...props} />), props };
}

beforeEach(() => {
  vi.clearAllMocks();
  listChatSessions.mockResolvedValue([]);
});

describe('StudentChatHistoryPanel — loading and empty state', () => {
  it('does not render sheet content when closed', () => {
    renderPanel({ open: false });
    expect(listChatSessions).not.toHaveBeenCalled();
    expect(screen.queryByText('Chat history')).not.toBeInTheDocument();
  });

  it('fetches sessions when opened and shows the empty state', async () => {
    listChatSessions.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(listChatSessions).toHaveBeenCalledWith(1));
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });

  it('shows sessions after they load', async () => {
    let resolve!: (sessions: ApiChatSession[]) => void;
    listChatSessions.mockReturnValue(new Promise((r) => { resolve = r; }));

    renderPanel();

    // Sessions not yet visible while pending
    expect(screen.queryByText('Guide')).not.toBeInTheDocument();

    resolve([SESSION_GUIDE]);

    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());
  });

  it('shows the no-activity placeholder when activityId is undefined', async () => {
    renderPanel({ activityId: undefined });
    expect(
      await screen.findByText('Open an activity to view chat history.'),
    ).toBeInTheDocument();
    expect(listChatSessions).not.toHaveBeenCalled();
  });
});

describe('StudentChatHistoryPanel — session list', () => {
  it('renders a row for each session with its mode badge', async () => {
    listChatSessions.mockResolvedValue([SESSION_GUIDE, SESSION_TEACH]);
    renderPanel();
    expect(await screen.findByText('Guide')).toBeInTheDocument();
    expect(await screen.findByText('Teach')).toBeInTheDocument();
  });

  it('displays relative timestamps for each session', async () => {
    listChatSessions.mockResolvedValue([SESSION_GUIDE, SESSION_TEACH]);
    renderPanel();
    expect(await screen.findByText('2m ago')).toBeInTheDocument();
    expect(await screen.findByText('1h ago')).toBeInTheDocument();
  });

  it('applies the active style to the currently open session', async () => {
    listChatSessions.mockResolvedValue([SESSION_GUIDE, SESSION_TEACH]);
    renderPanel({ activeChatId: SESSION_GUIDE.chatId });

    const activeBtn = await screen.findByRole('button', { name: /guide/i });
    expect(activeBtn).toHaveAttribute('aria-current', 'true');

    const inactiveBtn = screen.getByRole('button', { name: /teach/i });
    expect(inactiveBtn).not.toHaveAttribute('aria-current');
  });
});

describe('StudentChatHistoryPanel — interactions', () => {
  it('calls onSelect and closes the panel when a session row is clicked', async () => {
    listChatSessions.mockResolvedValue([SESSION_GUIDE]);
    const { props } = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /guide/i }));

    expect(props.onSelect).toHaveBeenCalledWith(SESSION_GUIDE);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onNewChat and closes the panel when "New chat" is clicked', async () => {
    listChatSessions.mockResolvedValue([]);
    const { props } = renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /new chat/i }));

    expect(props.onNewChat).toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

/** A pending listChatSessions call the test resolves/rejects on demand. */
function deferredListCall() {
  let resolve!: (value: ApiChatSession[]) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ApiChatSession[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  listChatSessions.mockReturnValueOnce(promise);
  return { resolve, reject };
}

describe('StudentChatHistoryPanel — load error state (#1000 / PR #1023)', () => {
  it('renders the error state with Retry when loading fails, not the empty state', async () => {
    listChatSessions.mockRejectedValueOnce(new Error('network down'));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/Couldn't load history/i)).toBeInTheDocument());
    expect(screen.queryByText(/No conversations yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Retry refetches and renders the sessions on success', async () => {
    listChatSessions.mockRejectedValueOnce(new Error('network down'));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/Couldn't load history/i)).toBeInTheDocument());

    listChatSessions.mockResolvedValueOnce([SESSION_GUIDE]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());
    expect(screen.queryByText(/Couldn't load history/i)).not.toBeInTheDocument();
    expect(listChatSessions).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale rejection that completes after a newer request succeeded', async () => {
    const { reject: rejectFirst } = deferredListCall();
    const { rerender } = renderPanel({ activityId: 1 });
    await waitFor(() => expect(listChatSessions).toHaveBeenCalledWith(1));

    // A newer request (activity change) resolves first…
    listChatSessions.mockResolvedValueOnce([SESSION_GUIDE]);
    rerender(
      <StudentChatHistoryPanel
        open
        onOpenChange={vi.fn()}
        activityId={2}
        activeChatId={null}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());

    // …then the old request fails. The stale rejection must not blank the
    // list or flip the panel into the error state.
    await act(async () => {
      rejectFirst(new Error('stale failure'));
    });

    expect(screen.getByText('Guide')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load history/i)).not.toBeInTheDocument();
  });
});
