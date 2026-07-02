import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";
import { reviveStoredMessage } from "~/lib/chat/revive-message.server";

/**
 * GET /api/chats/:chatId/messages — full ordered transcript for restore /
 * read-only viewing. Gated by the same visibility contract as the metadata
 * route; `canEdit` is owner-only.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
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

    const access = await resolveChatReadAccess(
      { id: session.user.id, role: session.user.role },
      chatId,
    );

    if (!access) {
      // Missing chat OR not authorized — same 404, no existence leak.
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { chat, canEdit } = access;
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
