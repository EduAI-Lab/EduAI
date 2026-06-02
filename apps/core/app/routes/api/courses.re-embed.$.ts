import type { ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { reEmbedCourseMaterials } from "~/lib/ai/embedding";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const courseId = params.courseId;
  if (!courseId) {
    return new Response(JSON.stringify({ error: "Course ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const course = await getCourseIfCanManageMaterials(session.user, courseId);
  if (!course) {
    return new Response(JSON.stringify({ error: "Course not found or access denied" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await reEmbedCourseMaterials(courseId);
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[re-embed] API failed:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Re-embed failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
