import type { LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { auth } from "~/lib/auth/server";
import { canAccessChat, getChatMessages } from "~/lib/chat-history/server";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Rehydrates a stored ChatMessage row back into an AI-SDK `Message` envelope so
 * the client can seed `useChat` (restore) or render a read-only transcript. The
 * DB stores the original JSON message; `messageId`/`role` are the escape hatch.
 */
function reviveStoredMessage(record: {
  messageId: string;
  role: string;
  content: Prisma.JsonValue;
}): Record<string, unknown> {
  if (record.content && typeof record.content === "object") {
    const parsed = record.content as Record<string, unknown>;
    return {
      ...parsed,
      id: isNonEmptyString(parsed.id) ? parsed.id : record.messageId,
      role: isNonEmptyString(parsed.role) ? parsed.role : record.role,
    };
  }
  return { id: record.messageId, role: record.role, content: "" };
}

/**
 * GET /api/chats/:chatId/messages — full ordered transcript for restore /
 * read-only viewing. Gated by the same visibility contract as the metadata
 * route; `canEdit` is owner-only.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const session = await auth.api.getSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const chatId = params.chatId;
    if (!chatId) {
      return new Response(JSON.stringify({ error: "Chat ID required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { chat, canEdit } = await canAccessChat(
      { id: session.user.id, role: session.user.role },
      chatId,
    );

    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await getChatMessages(chatId);
    const messages = rows.map(reviveStoredMessage);

    return new Response(
      JSON.stringify({
        chat: {
          id: chat.id,
          title: chat.title,
          systemPrompt: chat.systemPrompt,
          adhdAssist: chat.adhdAssist,
          courseId: chat.courseId,
          courseCode: chat.course?.code ?? null,
          courseName: chat.course?.name ?? null,
          ownerId: chat.userId,
          ownerName: chat.user.name,
          ownerEmail: chat.user.email,
          updatedAt: chat.updatedAt,
        },
        messages,
        canEdit,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Chat messages API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
