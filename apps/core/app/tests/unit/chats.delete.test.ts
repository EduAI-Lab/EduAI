// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn(), delete: vi.fn() },
  },
}));

import { action } from "~/routes/api/chats.$chatId";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

function makeArgs(chatId: string | undefined, method = "DELETE") {
  return {
    request: new Request(`http://localhost/api/chats/${chatId ?? ""}`, { method }),
    params: chatId ? { chatId } : {},
    context: {} as never,
  };
}

function mockUser(id: string, role = "STUDENT") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/chats/:chatId (#302)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("chat-1"));
    expect(res.status).toBe(401);
  });

  it("returns 405 for non-DELETE methods", async () => {
    const res = await action(makeArgs("chat-1", "PUT"));
    expect(res.status).toBe(405);
  });

  it("returns 400 when chatId param is missing", async () => {
    mockUser("u1");
    const res = await action(makeArgs(undefined));
    expect(res.status).toBe(400);
  });

  it("deletes own chat and returns 204", async () => {
    mockUser("u1");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({ id: "chat-1" } as never);
    const res = await action(makeArgs("chat-1"));
    expect(res.status).toBe(204);
    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { id: "chat-1", userId: "u1" },
      select: { id: true },
    });
    expect(prisma.chat.delete).toHaveBeenCalledWith({ where: { id: "chat-1" } });
  });

  it("returns 404 (not 403) for another user's chat — no existence leak", async () => {
    mockUser("intruder");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const res = await action(makeArgs("chat-1"));
    expect(res.status).toBe(404);
    expect(prisma.chat.delete).not.toHaveBeenCalled();
  });

  it("lets ADMIN delete any chat (§10)", async () => {
    mockUser("admin-1", "ADMIN");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({ id: "chat-1" } as never);
    const res = await action(makeArgs("chat-1"));
    expect(res.status).toBe(204);
    // Admin lookup is not ownership-scoped.
    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { id: "chat-1" },
      select: { id: true },
    });
  });

  it("returns 404 for a missing chat", async () => {
    mockUser("u1");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const res = await action(makeArgs("missing"));
    expect(res.status).toBe(404);
  });
});
