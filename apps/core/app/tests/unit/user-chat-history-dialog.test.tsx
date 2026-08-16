/**
 * UserChatHistoryDialog — lazily mounted from users-admin-view when an admin
 * opens a user's chat history (#1223). Covers the list/loading/error/empty
 * states, selecting a chat to view its transcript, and the back navigation.
 *
 * The real ChatTranscriptViewer pulls in the heavy chat-message chunk
 * (streamdown + shiki) this dialog was split out specifically to avoid
 * loading eagerly, so it's stubbed here — this file tests the dialog's own
 * state machine (list vs. transcript, loading/error/empty branches), not the
 * transcript renderer itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { UserChatHistoryDialog } from "~/components/admin/user-chat-history-dialog";
import type { ChatHistoryItem, ChatTranscript } from "~/hooks/api/use-chat-history";

const useChatHistory = vi.fn();
const fetchChatTranscript = vi.fn();

vi.mock("~/hooks/api/use-chat-history", () => ({
  useChatHistory: (...args: unknown[]) => useChatHistory(...args),
  fetchChatTranscript: (...args: unknown[]) => fetchChatTranscript(...args),
}));

vi.mock("~/components/chat/chat-transcript-viewer", () => ({
  ChatTranscriptViewer: (props: {
    messages: unknown[];
    ownerName?: string | null;
    courseCode?: string | null;
    isLoading?: boolean;
    continueChatId?: string;
  }) => (
    <div data-testid="transcript-viewer">
      <span data-testid="transcript-owner">{props.ownerName}</span>
      <span data-testid="transcript-course">{props.courseCode ?? ""}</span>
      <span data-testid="transcript-loading">{String(props.isLoading)}</span>
      <span data-testid="transcript-continue">{props.continueChatId ?? ""}</span>
      <span data-testid="transcript-count">{props.messages.length}</span>
    </div>
  ),
}));

const chat = (overrides: Partial<ChatHistoryItem> = {}): ChatHistoryItem => ({
  id: "chat-1",
  title: "Chat title",
  preview: "Chat preview text",
  courseId: "c1",
  courseCode: "COSC 101",
  courseName: "Intro to CS",
  userId: "u1",
  userName: "Student One",
  userEmail: "student@example.com",
  messageCount: 4,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof UserChatHistoryDialog>> = {}) {
  const onOpenChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <UserChatHistoryDialog
        open
        onOpenChange={onOpenChange}
        userId="u1"
        userName="Student One"
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onOpenChange, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatHistory.mockReturnValue({ chats: [], isLoading: false, error: null });
});

describe("UserChatHistoryDialog — loading/error/empty", () => {
  it("shows a spinner while chats are loading", () => {
    useChatHistory.mockReturnValue({ chats: [], isLoading: true, error: null });
    renderDialog();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the error message when the list read failed", () => {
    useChatHistory.mockReturnValue({ chats: [], isLoading: false, error: "Failed to load chat history" });
    renderDialog();
    expect(screen.getByText("Failed to load chat history")).toBeInTheDocument();
  });

  it("shows the empty state when there are no conversations", () => {
    renderDialog();
    expect(screen.getByText("No conversations for this user.")).toBeInTheDocument();
  });

  it("passes userId, limit and enabled=open through to useChatHistory", () => {
    renderDialog({ open: true, userId: "u42" });
    expect(useChatHistory).toHaveBeenCalledWith({ userId: "u42", limit: 50, enabled: true });
  });

  it("disables the chat-history fetch when the dialog is closed", () => {
    renderDialog({ open: false });
    expect(useChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});

describe("UserChatHistoryDialog — chat list rendering", () => {
  it("renders the dialog title with the user's name", () => {
    renderDialog({ userName: "Jamie Rivera" });
    expect(screen.getByText("Chat history — Jamie Rivera")).toBeInTheDocument();
  });

  it("renders preview, course code, and message count for each chat", () => {
    useChatHistory.mockReturnValue({
      chats: [chat({ preview: "Help with derivatives", messageCount: 6 })],
      isLoading: false,
      error: null,
    });
    renderDialog();
    expect(screen.getByText("Help with derivatives")).toBeInTheDocument();
    expect(screen.getByText("COSC 101")).toBeInTheDocument();
    expect(screen.getByText("· 6 msgs")).toBeInTheDocument();
  });

  it("falls back to the title, then 'New conversation', when there is no preview", () => {
    useChatHistory.mockReturnValue({
      chats: [
        chat({ id: "a", preview: null, title: "Titled chat" }),
        chat({ id: "b", preview: null, title: null }),
      ],
      isLoading: false,
      error: null,
    });
    renderDialog();
    expect(screen.getByText("Titled chat")).toBeInTheDocument();
    expect(screen.getByText("New conversation")).toBeInTheDocument();
  });

  it("omits the course badge when the chat has no course", () => {
    useChatHistory.mockReturnValue({
      chats: [chat({ courseCode: null })],
      isLoading: false,
      error: null,
    });
    renderDialog();
    expect(screen.queryByText("COSC 101")).not.toBeInTheDocument();
  });

  describe("relative timestamps", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders each relative-time bucket correctly", () => {
      const now = new Date("2026-08-12T12:00:00.000Z").getTime();
      const minus = (ms: number) => new Date(now - ms).toISOString();

      useChatHistory.mockReturnValue({
        chats: [
          chat({ id: "just-now", updatedAt: minus(30 * 1000) }),
          chat({ id: "minutes", updatedAt: minus(5 * 60 * 1000) }),
          chat({ id: "hours", updatedAt: minus(3 * 60 * 60 * 1000) }),
          chat({ id: "yesterday", updatedAt: minus(25 * 60 * 60 * 1000) }),
          chat({ id: "days", updatedAt: minus(3 * 24 * 60 * 60 * 1000) }),
        ],
        isLoading: false,
        error: null,
      });
      renderDialog();

      expect(screen.getByText("Just now")).toBeInTheDocument();
      expect(screen.getByText("5m ago")).toBeInTheDocument();
      expect(screen.getByText("3h ago")).toBeInTheDocument();
      expect(screen.getByText("Yesterday")).toBeInTheDocument();
      expect(screen.getByText("3d ago")).toBeInTheDocument();
    });

    it("falls back to a plain date beyond a week", () => {
      const now = new Date("2026-08-12T12:00:00.000Z").getTime();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
      useChatHistory.mockReturnValue({
        chats: [chat({ updatedAt: tenDaysAgo.toISOString() })],
        isLoading: false,
        error: null,
      });
      renderDialog();
      expect(screen.getByText(tenDaysAgo.toLocaleDateString())).toBeInTheDocument();
    });
  });
});

describe("UserChatHistoryDialog — selecting a chat", () => {
  beforeEach(() => {
    useChatHistory.mockReturnValue({
      chats: [chat({ id: "chat-9", preview: "Pick me" })],
      isLoading: false,
      error: null,
    });
  });

  it("fetches the transcript and renders it when a chat is clicked", async () => {
    const transcript: ChatTranscript = {
      chat: {
        id: "chat-9",
        title: "Pick me",
        systemPrompt: null,
        adhdAssist: false,
        courseId: "c1",
        courseCode: "COSC 101",
        courseName: "Intro to CS",
        ownerId: "u1",
        ownerName: "Student One",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      messages: [{ id: "m1", role: "user", content: "hi" }],
      canEdit: true,
    };
    fetchChatTranscript.mockResolvedValue(transcript);

    renderDialog();
    fireEvent.click(screen.getByText("Pick me"));

    expect(fetchChatTranscript).toHaveBeenCalledWith("chat-9");
    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("transcript-count")).toHaveTextContent("1");
    expect(screen.getByTestId("transcript-continue")).toHaveTextContent("chat-9");
    expect(screen.getByTestId("transcript-course")).toHaveTextContent("COSC 101");
    expect(screen.getByRole("button", { name: /back to conversations/i })).toBeInTheDocument();
  });

  it("does not offer to continue the chat when the viewer can't edit it", async () => {
    fetchChatTranscript.mockResolvedValue({
      chat: {
        id: "chat-9",
        title: null,
        systemPrompt: null,
        adhdAssist: false,
        courseId: null,
        courseCode: null,
        courseName: null,
        ownerId: "u1",
        ownerName: "Student One",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      messages: [],
      canEdit: false,
    } satisfies ChatTranscript);

    renderDialog();
    fireEvent.click(screen.getByText("Pick me"));

    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("transcript-continue")).toHaveTextContent("");
  });

  it("returns to the chat list when Back is clicked", async () => {
    fetchChatTranscript.mockResolvedValue({
      chat: {
        id: "chat-9",
        title: null,
        systemPrompt: null,
        adhdAssist: false,
        courseId: null,
        courseCode: null,
        courseName: null,
        ownerId: "u1",
        ownerName: "Student One",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      messages: [],
      canEdit: false,
    } satisfies ChatTranscript);

    renderDialog();
    fireEvent.click(screen.getByText("Pick me"));
    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /back to conversations/i }));
    expect(screen.getByText("Pick me")).toBeInTheDocument();
    expect(screen.queryByTestId("transcript-viewer")).not.toBeInTheDocument();
  });

  it("handles a transcript fetch that resolves null", async () => {
    fetchChatTranscript.mockResolvedValue(null);
    renderDialog();
    fireEvent.click(screen.getByText("Pick me"));

    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("transcript-count")).toHaveTextContent("0");
  });
});

describe("UserChatHistoryDialog — closing", () => {
  it("calls onOpenChange(false) when the built-in close control is used", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
