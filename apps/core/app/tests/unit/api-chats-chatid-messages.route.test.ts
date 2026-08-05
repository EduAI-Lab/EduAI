// @vitest-environment node
// #1213 — GET /api/chats/:chatId/messages: auth gate, missing chatId, the
// no-existence-leak 404 for a missing/unauthorized chat, and the success
// shape (chat summary + revived messages + canEdit).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/chat-history/server", () => ({
  resolveChatReadAccess: vi.fn(),
  getChatMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/chat/revive-message.server", () => ({
  reviveStoredMessage: vi.fn((row: unknown) => row),
}));

import { loader } from "~/routes/api/chats.$chatId.messages";
import { auth } from "~/lib/auth/server";
import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";

function makeArgs(chatId?: string) {
  return {
    request: new Request("http://localhost/api/chats/chat-1/messages"),
    params: chatId === undefined ? { chatId: "chat-1" } : { chatId },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  vi.mocked(getChatMessages).mockResolvedValue([]);
});

describe("GET /api/chats/:chatId/messages", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
  });

  it("returns 400 when :chatId is missing", async () => {
    const res = await loader(makeArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 404 (no existence leak) when access is denied or the chat is missing", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(null);
    const res = await loader(makeArgs());
    expect(res.status).toBe(404);
  });

  it("returns the chat summary, revived messages, and canEdit on success", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue({
      chat: {
        id: "chat-1",
        title: "Chat",
        systemPrompt: null,
        adhdAssist: false,
        courseId: "course-1",
        course: { code: "COSC101", name: "Intro" },
        userId: "owner-1",
        user: { name: "Owner" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      canEdit: true,
    } as never);
    vi.mocked(getChatMessages).mockResolvedValue([{ id: "m1" }] as never);

    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      chat: {
        id: "chat-1",
        title: "Chat",
        systemPrompt: null,
        adhdAssist: false,
        courseId: "course-1",
        courseCode: "COSC101",
        courseName: "Intro",
        ownerId: "owner-1",
        ownerName: "Owner",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      messages: [{ id: "m1" }],
      canEdit: true,
    });
  });

  it("maps an unexpected error to a 500", async () => {
    vi.mocked(resolveChatReadAccess).mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await loader(makeArgs());
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});
