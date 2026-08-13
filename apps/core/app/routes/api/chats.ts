import type { LoaderFunctionArgs } from "react-router";
import { listChats } from "~/lib/chat-history/server";
import { getRequestSession } from "~/lib/auth/request-session.server";

/**
 * GET /api/chats?limit=N&courseId=&userId=&scope=own|all
 *
 * Returns chats visible to the caller, newest-first (see lib/chat-history for
 * the visibility contract). Used by the dashboard "Recent Conversations" panel,
 * the chat-history sidebar (scope=own), the course-detail chat-history tab
 * (courseId, optional userId), and admin per-user history (userId).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await getRequestSession(request);
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "30"), 100);
    const courseId = url.searchParams.get("courseId") ?? undefined;
    const userId = url.searchParams.get("userId") ?? undefined;
    const scopeParam = url.searchParams.get("scope");
    const scope = scopeParam === "own" ? "own" : scopeParam === "all" ? "all" : undefined;

    const chats = await listChats(
      {
        id: session.user.id,
        role: session.user.role,
      },
      { limit, courseId, userId, scope },
    );

    return new Response(JSON.stringify({ chats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chats list API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
