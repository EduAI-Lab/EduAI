import { describe, it, expect, vi, beforeEach } from "vitest";

import { loadPriorChatDigestForNewThread } from "~/lib/chat-cross-session.server";
import { PRIOR_CHAT_DIGEST_MESSAGE_ID } from "~/lib/chat-rag";

describe("loadPriorChatDigestForNewThread", () => {
  const reviveStoredMessage = (record: {
    messageId: string;
    role: string;
    content: unknown;
  }) => ({
    id: record.messageId,
    role: record.role,
    content: record.content,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the current thread already has stored messages", async () => {
    const prisma = {
      chat: { findFirst: vi.fn() },
      chatMessage: { findMany: vi.fn() },
    };

    const result = await loadPriorChatDigestForNewThread(prisma as never, {
      userId: "u1",
      courseId: null,
      currentChatId: "chat-new",
      storedMessageCount: 2,
      incomingMessageCount: 1,
      reviveStoredMessage,
    });

    expect(result).toBeNull();
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when there is no prior chat in the same course scope", async () => {
    const prisma = {
      chat: { findFirst: vi.fn().mockResolvedValue(null) },
      chatMessage: { findMany: vi.fn() },
    };

    const result = await loadPriorChatDigestForNewThread(prisma as never, {
      userId: "u1",
      courseId: "course-1",
      currentChatId: "chat-new",
      storedMessageCount: 0,
      incomingMessageCount: 1,
      reviveStoredMessage,
    });

    expect(result).toBeNull();
    expect(prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          courseId: "course-1",
          id: { not: "chat-new" },
        }),
      }),
    );
  });

  it("builds a prior-chat digest from the most recent prior thread", async () => {
    const prisma = {
      chat: { findFirst: vi.fn().mockResolvedValue({ id: "chat-old" }) },
      chatMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            messageId: "m1",
            role: "user",
            content: "Help me plan a 3-hour study session for the midterm.",
          },
          {
            messageId: "m2",
            role: "assistant",
            content: "Hour 1: review chapters 1–3. First 25 minutes: skim notes.",
          },
        ]),
      },
    };

    const result = await loadPriorChatDigestForNewThread(prisma as never, {
      userId: "u1",
      courseId: "course-1",
      currentChatId: "chat-new",
      storedMessageCount: 0,
      incomingMessageCount: 1,
      reviveStoredMessage,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(PRIOR_CHAT_DIGEST_MESSAGE_ID);
    expect(result?.role).toBe("user");
    expect(String(result?.content)).toContain("Prior chat digest");
    expect(String(result?.content)).toContain("Hour 1");
  });
});
