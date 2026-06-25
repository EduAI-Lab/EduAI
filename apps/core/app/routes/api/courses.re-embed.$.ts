import type { ActionFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";
import {
  findActiveReEmbedJob,
  serializeReEmbedJob,
  startReEmbedJob,
} from "~/lib/ai/re-embed-job.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const requestContext = getRequestContext(request);

  const courseId = params.courseId;
  if (!courseId) {
    return jsonResponse({ error: "Course ID is required" }, 400);
  }

  try {
    const course = await getCourseIfCanManageMaterials(session.user, courseId);
    if (!course) {
      return jsonResponse({ error: "Course not found or access denied" }, 404);
    }

    const existing = await findActiveReEmbedJob(courseId);
    const job = existing ?? (await startReEmbedJob(courseId));

    // Only a freshly-started job is a "created" event; reusing an active job is
    // a no-op and must not be logged as a creation.
    if (!existing) {
      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "RE_EMBED_JOB_CREATED",
          category: "AI_CONFIG",
          entityType: "ReEmbedJob",
          entityId: job.id,
          details: { courseId },
        }),
      );
    }

    return jsonResponse(
      {
        success: true,
        job: serializeReEmbedJob(job),
        reusedExistingJob: Boolean(existing),
      },
      existing ? 200 : 202,
    );
  } catch (error) {
    console.error("[re-embed] API failed:", error);
    return jsonResponse(formatApiError(error), 500);
  }
}
