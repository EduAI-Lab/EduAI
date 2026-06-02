import type { ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";
import { reEmbedCourseMaterials } from "~/lib/ai/embedding";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const courseId = params.courseId;
  if (!courseId) {
    return jsonResponse({ error: "Course ID is required" }, 400);
  }

  const course = await getCourseIfCanManageMaterials(session.user, courseId);
  if (!course) {
    return jsonResponse({ error: "Course not found or access denied" }, 404);
  }

  try {
    const result = await reEmbedCourseMaterials(courseId);
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    console.error("[re-embed] API failed:", error);
    return jsonResponse(formatApiError(error), 500);
  }
}
