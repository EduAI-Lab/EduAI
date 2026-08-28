import type { LoaderFunctionArgs } from "react-router";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { jsonResponse } from "~/lib/api/json-response.server";
import { getReEmbedJobForCourse, serializeReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const session = await getRequestSession(request);
      if (!session?.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const courseId = params.courseId;
      const jobId = params.jobId;
      if (!courseId || !jobId) {
        return jsonResponse({ error: "Course ID and job ID are required" }, 400);
      }

      const course = await getCourseIfCanManageMaterials(session.user, courseId);
      if (!course) {
        return jsonResponse({ error: "Course not found or access denied" }, 404);
      }

      const job = await getReEmbedJobForCourse(courseId, jobId);
      if (!job) {
        return jsonResponse({ error: "Re-index job not found" }, 404);
      }

      return jsonResponse({ job: serializeReEmbedJob(job) });
    },
    { request },
  );
}
