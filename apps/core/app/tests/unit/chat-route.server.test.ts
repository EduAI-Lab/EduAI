// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/chat-history/server", () => ({
  resolveChatReadAccess: vi.fn(),
  getChatMessages: vi.fn(),
}));

import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";
import { loadChatTranscript } from "~/lib/chat/chat-route.server";

const CHAT_ACCESS = {
  chat: {
    id: "chat-1",
    userId: "owner-1",
    courseId: "c1",
    systemPrompt: null,
    title: "Test chat",
    adhdAssist: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    course: { id: "c1", code: "COSC 101", name: "Intro" },
    user: { id: "owner-1", name: "Alex Patel", email: "student1@eduai.local" },
  },
  isOwner: true,
  canEdit: true,
};

describe("loadChatTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the viewer may not read the chat", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(null);

    const result = await loadChatTranscript(
      { id: "other-user", role: "STUDENT" },
      "chat-1",
    );

    expect(result).toBeNull();
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  it("returns a hydrated transcript for an authorized owner", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(CHAT_ACCESS);
    vi.mocked(getChatMessages).mockResolvedValue([
      { messageId: "m1", role: "user", content: { id: "m1", role: "user", content: "hello" } },
    ]);

    const result = await loadChatTranscript(
      { id: "owner-1", role: "STUDENT" },
      "chat-1",
    );

    expect(result).not.toBeNull();
    expect(result!.canEdit).toBe(true);
    expect(result!.chat.id).toBe("chat-1");
    expect(result!.chat.courseCode).toBe("COSC 101");
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(getChatMessages).toHaveBeenCalledWith("chat-1");
  });

  it("marks oversight reads as non-editable", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue({
      ...CHAT_ACCESS,
      isOwner: false,
      canEdit: false,
    });
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const result = await loadChatTranscript(
      { id: "instr-1", role: "INSTRUCTOR" },
      "chat-1",
    );

    expect(result!.canEdit).toBe(false);
  });
});
