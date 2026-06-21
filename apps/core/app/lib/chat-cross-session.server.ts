import type { Prisma, PrismaClient } from "@prisma/client";

import {
  buildPriorChatDigestMessage,
  extractMessageText,
  resolveMaxContextMessages,
} from "~/lib/chat-rag";

export type PriorChatStoredMessageRecord = {
  messageId: string;
  role: string;
  content: Prisma.JsonValue;
};

type GenericMessage = Record<string, any>;

/**
 * Loads a request-scoped prior-chat digest when the user sends the first turn
 * on a new thread (cross-session continuity for S3-style resumption).
 */
export async function loadPriorChatDigestForNewThread(
  prisma: PrismaClient,
  opts: {
    userId: string;
    courseId: string | null;
    currentChatId: string;
    storedMessageCount: number;
    incomingMessageCount: number;
    reviveStoredMessage: (record: PriorChatStoredMessageRecord) => GenericMessage;
  },
): Promise<GenericMessage | null> {
  if (opts.storedMessageCount > 0 || opts.incomingMessageCount === 0) {
    return null;
  }

  const priorChat = await prisma.chat.findFirst({
    where: {
      userId: opts.userId,
      courseId: opts.courseId,
      id: { not: opts.currentChatId },
      messages: { some: {} },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (!priorChat) {
    return null;
  }

  const maxContextMessages = resolveMaxContextMessages();
  const priorRecords = await prisma.chatMessage.findMany({
    where: { chatId: priorChat.id },
    orderBy: { position: "desc" },
    take: maxContextMessages,
  });

  const priorMessages = priorRecords
    .reverse()
    .map((record) =>
      opts.reviveStoredMessage({
        messageId: record.messageId,
        role: record.role,
        content: record.content,
      }),
    );

  return buildPriorChatDigestMessage(priorMessages, {
    previewText: extractMessageText,
  });
}
