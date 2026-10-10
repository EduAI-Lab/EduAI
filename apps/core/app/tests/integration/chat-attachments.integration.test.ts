// @vitest-environment node
// #1902: a chat attachment persisted in chat_messages.content survives the
// Json round trip, comes back through the restore loader, and still yields
// fenced model text for a follow-up turn.
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { loader } from "~/routes/api/chats.$chatId.messages";
import { encodeTextDataUrl, toModelMessage } from "~/lib/chat/chat-attachments";
import { cleanupRbac, mockSession, seedUser } from "../helpers/rbac";

const userIds: string[] = [];

afterAll(async () => {
  await cleanupRbac({ userIds });
  await prisma.$disconnect();
});

describe("chat attachment persistence", () => {
  it("round-trips an attachment through chat_messages and the restore loader", async () => {
    const user = await seedUser({ role: "STUDENT" });
    userIds.push(user.id);
    const chat = await prisma.chat.create({ data: { userId: user.id } });
    const attachment = {
      name: "notes.md",
      contentType: "text/plain",
      url: encodeTextDataUrl("Résumé body"),
    };
    await prisma.chatMessage.create({
      data: {
        chatId: chat.id,
        messageId: "u1",
        role: "user",
        content: {
          id: "u1",
          role: "user",
          content: "see file",
          experimental_attachments: [attachment],
        },
      },
    });

    mockSession({ id: user.id, role: "STUDENT" });
    const res = await loader({
      request: new Request(`http://localhost/api/chats/${chat.id}/messages`),
      params: { chatId: chat.id },
      context: {} as never,
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const restored = body.messages.find((m: { id: string }) => m.id === "u1");
    expect(restored.experimental_attachments).toEqual([attachment]);

    const stored = await prisma.chatMessage.findFirstOrThrow({ where: { chatId: chat.id } });
    const model = toModelMessage(
      stored.content as { content?: string; experimental_attachments?: object[] },
    );
    expect(model.content).toContain(
      '<student_attachment name="notes.md">\nRésumé body\n</student_attachment>',
    );

    await prisma.chat.delete({ where: { id: chat.id } });
  });
});
