import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

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

    const chat = await prisma.chat.findFirst({
      where: { id: chatId },
      select: {
        id: true,
        userId: true,
        courseId: true,
        systemPrompt: true,
        title: true,
        adhdAssist: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          select: { messageId: true, role: true, content: true, position: true },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Owner and ADMIN may always read. §5c: a course-authorized viewer
    // (instructor/unit-admin) may read a course chat when their flag is on.
    let authorized = chat.userId === session.user.id || session.user.role === "ADMIN";
    if (!authorized && chat.courseId) {
      const { access } = await resolveCourseAccessWithCourse(session.user, chat.courseId);
      if (
        access?.level === "instructor" &&
        (await getPolicy("instructors.canViewCourseChats"))
      ) {
        authorized = true;
      } else if (
        access?.level === "unit" &&
        (await getPolicy("unitAdmins.canViewUnitChats"))
      ) {
        authorized = true;
      }
    }

    if (!authorized) {
      // No existence leak — same 404 a non-owner gets for a missing chat.
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { userId: _userId, courseId: _courseId, ...chatView } = chat;
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
