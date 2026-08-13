/**
 * Unit tests for the shared `DashboardView` container (dashboard-view.tsx).
 *
 * dashboard-ta-view.test.tsx / dashboard-student-view.test.tsx /
 * dashboard-view-config.test.tsx already cover per-role wiring through
 * `DashboardBody`. This file targets `DashboardView`'s own branching logic
 * directly: quick-actions vs. course-list panel selection, loading/empty
 * states for both side panels, the recent-chats transcript dialog flow, and
 * the analytics slot — with `ChatTranscriptViewer` and `fetchChatTranscript`
 * mocked so only DashboardView's own logic is under test.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  DashboardView,
  type DashboardViewProps,
  type DashboardCourse,
  type DashboardRecentChat,
} from "~/components/dashboard/dashboard-view";
import { fetchChatTranscript } from "~/hooks/api/use-chat-history";

vi.mock("~/hooks/api/use-chat-history", () => ({
  fetchChatTranscript: vi.fn(),
}));

vi.mock("~/components/chat/chat-transcript-viewer", () => ({
  ChatTranscriptViewer: (props: Record<string, unknown>) => (
    <div data-testid="transcript-viewer">{JSON.stringify(props)}</div>
  ),
}));

const mockFetchChatTranscript = vi.mocked(fetchChatTranscript);

const course1: DashboardCourse = {
  id: "course-1",
  code: "CS101",
  name: "Intro to CS",
  term: "Fall",
  year: 2026,
};

const course2: DashboardCourse = {
  id: "course-2",
  code: "CS201",
  name: "Data Structures",
  term: "Fall",
  year: 2026,
};

const chat1: DashboardRecentChat = {
  id: "chat-1",
  title: "Chat title",
  preview: "Hello there",
  courseCode: "CS101",
  courseName: "Intro to CS",
  userName: "Jane Doe",
  updatedAt: new Date().toISOString(),
};

const chat2: DashboardRecentChat = {
  id: "chat-2",
  title: null,
  preview: null,
  courseCode: null,
  courseName: null,
  userName: null,
  updatedAt: new Date().toISOString(),
};

const baseProps: DashboardViewProps = {
  stats: [
    { label: "Total users", value: 5, trend: 10, trendLabel: "vs last week" },
    { label: "Active courses", value: 2 },
  ],
  courses: [course1, course2],
  coursesLoading: false,
  recentChats: [chat1, chat2],
  recentChatsLoading: false,
};

function renderDashboard(props: Partial<DashboardViewProps> = {}) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <DashboardView {...baseProps} {...props} /> },
      { path: "/chat", element: <div>Chat page</div> },
      { path: "/courses", element: <div>Courses page</div> },
      { path: "/courses/:id", element: <div>Course detail page</div> },
    ],
    { initialEntries: ["/"] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

beforeEach(() => {
  mockFetchChatTranscript.mockReset();
  mockFetchChatTranscript.mockResolvedValue({
    chat: {
      id: "chat-1",
      title: "Chat title",
      systemPrompt: null,
      adhdAssist: false,
      courseId: null,
      courseCode: "CS101",
      courseName: "Intro to CS",
      ownerId: "user-1",
      ownerName: "Jane Doe",
      updatedAt: new Date().toISOString(),
    },
    messages: [{ role: "user", content: "hi" }],
    canEdit: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardView", () => {
  it("renders stat cards", () => {
    renderDashboard();

    expect(screen.getByText("Total users")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Active courses")).toBeInTheDocument();
  });

  it("renders the course-list panel with default title when no quick actions are given", () => {
    renderDashboard();

    expect(screen.getByText("Your courses")).toBeInTheDocument();
    expect(screen.getAllByText("CS101").length).toBeGreaterThan(0);
    expect(screen.getByText("CS201")).toBeInTheDocument();
  });

  it("renders the quick-actions panel instead of courses when quickActions are given", () => {
    renderDashboard({
      quickActions: [
        { label: "User management", description: "Manage users", href: "/admin/users", icon: null },
      ],
    });

    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(screen.getByText("User management")).toBeInTheDocument();
    // Course panel content must not render alongside quick actions.
    expect(screen.queryByText("CS201")).not.toBeInTheDocument();
  });

  it("honors an explicit leftPanelTitle override", () => {
    renderDashboard({ leftPanelTitle: "Assigned courses" });

    expect(screen.getByText("Assigned courses")).toBeInTheDocument();
    expect(screen.queryByText("Your courses")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton for the course panel and hides course rows", () => {
    renderDashboard({ coursesLoading: true });

    expect(screen.queryByText("CS201")).not.toBeInTheDocument();
    expect(screen.queryByText("No courses found.")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when there are no courses", () => {
    renderDashboard({ courses: [] });

    expect(screen.getByText("No courses found.")).toBeInTheDocument();
    expect(screen.getByText("Browse courses →")).toBeInTheDocument();
  });

  it("defaults to an empty course list when courses is undefined", () => {
    renderDashboard({ courses: undefined });

    expect(screen.getByText("No courses found.")).toBeInTheDocument();
  });

  it("navigates to the course chat route without following the row's own link", () => {
    const { router } = renderDashboard();

    fireEvent.click(screen.getAllByRole("button", { name: "Chat" })[0]);

    expect(router.state.location.pathname).toBe("/chat");
    expect(router.state.location.search).toBe("?courseCode=CS101");
  });

  it("does not render an analytics slot when analytics is not provided", () => {
    renderDashboard();
    expect(screen.queryByText("Analytics content")).not.toBeInTheDocument();
  });

  it("renders the analytics slot when provided", () => {
    renderDashboard({ analytics: <div>Analytics content</div> });
    expect(screen.getByText("Analytics content")).toBeInTheDocument();
  });

  it("shows a loading skeleton for recent chats and hides chat rows", () => {
    renderDashboard({ recentChatsLoading: true });

    expect(screen.queryByText("Hello there")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when there are no recent chats", () => {
    renderDashboard({ recentChats: [] });

    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });

  it("renders course badge + user name for a chat with a course, and 'General' + no user name badge otherwise", () => {
    renderDashboard();

    expect(screen.getAllByText("CS101").length).toBeGreaterThan(0);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("falls back to title, then 'New conversation', when a chat has no preview", () => {
    renderDashboard({
      recentChats: [
        { ...chat1, preview: null, title: "Fallback title" },
        { ...chat2, preview: null, title: null },
      ],
    });

    expect(screen.getByText("Fallback title")).toBeInTheDocument();
    expect(screen.getByText("New conversation")).toBeInTheDocument();
  });

  it("opens the transcript dialog on click, shows a spinner while loading, then the transcript", async () => {
    renderDashboard();

    fireEvent.click(screen.getByText("Hello there"));

    expect(mockFetchChatTranscript).toHaveBeenCalledWith("chat-1");
    await waitFor(() =>
      expect(screen.getByText(/Jane Doe's conversation/)).toBeInTheDocument(),
    );

    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());

    const viewerProps = JSON.parse(screen.getByTestId("transcript-viewer").textContent ?? "{}");
    expect(viewerProps.ownerName).toBe("Jane Doe");
    expect(viewerProps.courseCode).toBe("CS101");
    // canEdit: true in the mocked transcript, so continueChatId is passed.
    expect(viewerProps.continueChatId).toBe("chat-1");
  });

  it("does not pass a continueChatId when the transcript can't be edited", async () => {
    mockFetchChatTranscript.mockResolvedValue({
      chat: {
        id: "chat-1",
        title: null,
        systemPrompt: null,
        adhdAssist: false,
        courseId: null,
        courseCode: null,
        courseName: null,
        ownerId: "user-1",
        ownerName: null,
        updatedAt: new Date().toISOString(),
      },
      messages: [],
      canEdit: false,
    });

    renderDashboard();
    fireEvent.click(screen.getByText("Hello there"));

    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());
    const viewerProps = JSON.parse(screen.getByTestId("transcript-viewer").textContent ?? "{}");
    expect(viewerProps.continueChatId).toBeUndefined();
  });

  it("falls back to a generic dialog title/description for a chat with no title, preview, or user", async () => {
    renderDashboard();

    fireEvent.click(screen.getByText("New conversation"));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Conversation").length).toBeGreaterThan(0);
  });

  it("resets selected chat and transcript when the dialog is closed", async () => {
    renderDashboard();

    fireEvent.click(screen.getByText("Hello there"));
    await waitFor(() => expect(screen.getByTestId("transcript-viewer")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    await waitFor(() =>
      expect(screen.queryByText("Jane Doe's conversation")).not.toBeInTheDocument(),
    );
  });
});
