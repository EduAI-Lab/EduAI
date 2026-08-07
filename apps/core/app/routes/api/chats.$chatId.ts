import { auth } from "~/lib/auth/server";
import { resolveChatReadAccess } from "~/lib/chat-history/server";
import prisma from "~/lib/prisma.server";
import { parseCursorParams, splitPage } from "~/lib/cursor-list.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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

    // §5c oversight gate, shared with /api/chats/:id/messages so the two routes
    // can never drift. Returns null for a missing chat OR an unauthorized viewer.
    const access = await resolveChatReadAccess(
      { id: session.user.id, role: session.user.role },
      chatId,
    );

    if (!access) {
      // No existence leak — same 404 a non-owner gets for a missing chat.
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { chat, isOwner } = access;

    // Message bodies are only needed by the oversight viewer (a non-owner staff
    // read). The owner's session-resume path (useChatSession) reads metadata
    // only, so don't pull the full transcript on that hot path. Bounded to a
    // cursor "load more" page instead of the whole transcript (#1042).
    let messages: { messageId: string; role: string; content: unknown; position: number }[] | undefined;
    let nextCursor: string | null = null;
    if (!isOwner) {
      const url = new URL(request.url);
      const { cursor, limit } = parseCursorParams(url.searchParams);
      const rows = await prisma.chatMessage.findMany({
        where: { chatId: chat.id },
        select: { id: true, messageId: true, role: true, content: true, position: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const split = splitPage(rows, limit);
      messages = split.page.map(({ messageId, role, content, position }) => ({
        messageId,
        role,
        content,
        position,
      }));
      nextCursor = split.nextCursor;
    }

    const meta = {
      id: chat.id,
      title: chat.title,
      systemPrompt: chat.systemPrompt,
      adhdAssist: chat.adhdAssist,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
    const chatView = messages ? { ...meta, messages, nextCursor } : meta;
    return new Response(JSON.stringify(chatView), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}


/**
 * DELETE /api/chats/:chatId (#302, §10) — owner-only; ADMIN may delete any
 * chat. Returns 204 on success.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "DELETE") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

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

    const isAdmin = session.user.role === "ADMIN";
    const chat = await prisma.chat.findFirst({
      where: isAdmin ? { id: chatId } : { id: chatId, userId: session.user.id },
      select: { id: true },
    });

    if (!chat) {
      // Non-owners get the same 404 as a missing chat — no existence leak.
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.chat.delete({ where: { id: chatId } });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
