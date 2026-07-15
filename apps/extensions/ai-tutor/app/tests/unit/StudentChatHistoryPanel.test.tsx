/**
 * Covers the #1000 (PR #1023) error paths in StudentChatHistoryPanel:
 *   - a failed session-list load renders the "Couldn't load history" state
 *     with a working Retry (instead of the misleading "No conversations yet");
 *   - out-of-order completions are ignored, so a stale rejection can't
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

const SESSION: ApiChatSession = {
  id: 1,
  chatId: 'c1',
  mode: 'guide',
  modelId: null,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
};

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

function renderPanel(activityId: number | undefined = 1) {
  return render(
    <StudentChatHistoryPanel
      open
      onOpenChange={vi.fn()}
      activityId={activityId}
      activeChatId={null}
      onSelect={vi.fn()}
      onNewChat={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

    listChatSessions.mockResolvedValueOnce([SESSION]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());
    expect(screen.queryByText(/Couldn't load history/i)).not.toBeInTheDocument();
    expect(listChatSessions).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale rejection that completes after a newer request succeeded', async () => {
    const { reject: rejectFirst } = deferredListCall();
    const { rerender } = renderPanel(1);
    await waitFor(() => expect(listChatSessions).toHaveBeenCalledWith(1));

    // A newer request (activity change) resolves first…
    listChatSessions.mockResolvedValueOnce([SESSION]);
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
