import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { courseChatViewPolicyKey } from "~/lib/rbac/permissions";
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
      },
    });

    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isOwner = chat.userId === session.user.id;

    // Owner and ADMIN may always read. §5c: a course-authorized viewer
    // (instructor/unit-admin) may read a course chat when their grant flag is on
    // — resolved through the shared chat-visibility gate so this route can't
    // drift from the course/unit chat list endpoints.
    let authorized = isOwner || session.user.role === "ADMIN";
    if (!authorized && chat.courseId) {
      const { access } = await resolveCourseAccessWithCourse(session.user, chat.courseId);
      const gate = courseChatViewPolicyKey(access?.level ?? null);
      const gateOpen =
        gate === "always" || (gate !== "never" && (await getPolicy(gate)));
      if (gateOpen) {
        // Oversight is limited to STUDENT-owned chats — the same owner-role
        // filter the course/unit list endpoints apply. Without this, a
        // co-instructor/TA/unit-admin with the grant on could read another
        // staff member's private course chat.
        const ownerIsStudent = await prisma.enrollment.findFirst({
          where: {
            courseId: chat.courseId,
            userId: chat.userId,
            role: "STUDENT",
            isActive: true,
          },
          select: { id: true },
        });
        authorized = ownerIsStudent !== null;
      }
    }

    if (!authorized) {
      // No existence leak — same 404 a non-owner gets for a missing chat.
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Message bodies are only needed by the oversight viewer (a non-owner staff
    // read). The owner's session-resume path (useChatSession) reads metadata
    // only, so don't pull the full transcript on that hot path.
    const messages = isOwner
      ? undefined
      : await prisma.chatMessage.findMany({
          where: { chatId: chat.id },
          select: { messageId: true, role: true, content: true, position: true },
          orderBy: { position: "asc" },
        });

    const { userId: _userId, courseId: _courseId, ...meta } = chat;
    const chatView = messages ? { ...meta, messages } : meta;
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
