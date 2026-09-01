import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatHistoryList } from "~/components/chat/chat-history-list";
import type { ChatHistoryItem } from "~/hooks/api/use-chat-history";

const { mockApiFetch, mockToastError } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("~/hooks/api/config", () => ({ apiFetch: mockApiFetch }));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

const chat = {
  id: "chat-1",
  title: "Pilot conversation",
  preview: null,
  courseId: "course-1",
  courseCode: "COSC 101",
  courseName: "Introduction to Computer Science",
  userId: "user-1",
  userName: "Student",
  userEmail: "student@example.com",
  messageCount: 2,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
} satisfies ChatHistoryItem;

describe("ChatHistoryList deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms first and surfaces a failed delete without refreshing", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("network unavailable"));
    const onRefresh = vi.fn();

    render(
      <ChatHistoryList
        chats={[chat]}
        isLoading={false}
        error={null}
        activeChatId={chat.id}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Could not delete conversation", {
        description: "network unavailable",
      }),
    );
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /Pilot conversation/ })).toBeInTheDocument();
  });
});
