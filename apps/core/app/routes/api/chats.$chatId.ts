import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { canAccessChat } from "~/lib/chat-history/server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

/**
 * GET /api/chats/:chatId — chat metadata. Readable by the owner and by anyone
 * with course-staff/admin visibility (see lib/chat-history). `canEdit` is true
 * only for the owner; read-only viewers use it to suppress the composer.
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

    return new Response(
      JSON.stringify({
        id: chat.id,
        systemPrompt: chat.systemPrompt,
        title: chat.title,
        adhdAssist: chat.adhdAssist,
        courseId: chat.courseId,
        courseCode: chat.course?.code ?? null,
        courseName: chat.course?.name ?? null,
        ownerId: chat.userId,
        ownerName: chat.user.name,
        ownerEmail: chat.user.email,
        canEdit,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
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
