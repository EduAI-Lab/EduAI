import type { LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";
import {
  getReEmbedJobForCourse,
  serializeReEmbedJob,
} from "~/lib/ai/re-embed-job.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const courseId = params.courseId;
  const jobId = params.jobId;
  if (!courseId || !jobId) {
    return jsonResponse({ error: "Course ID and job ID are required" }, 400);
  }

  try {
    const course = await getCourseIfCanManageMaterials(session.user, courseId);
    if (!course) {
      return jsonResponse({ error: "Course not found or access denied" }, 404);
    }

    const job = await getReEmbedJobForCourse(courseId, jobId);
    if (!job) {
      return jsonResponse({ error: "Re-index job not found" }, 404);
    }

    return jsonResponse({ job: serializeReEmbedJob(job) });
  } catch (error) {
    console.error("[re-embed-job] GET failed:", error);
    return jsonResponse(formatApiError(error), 500);
  }
}
