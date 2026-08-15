import type { ActionFunctionArgs } from "react-router";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";
import { serializeReEmbedJob, startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { httpStatusForEnqueueError } from "~/lib/queue/errors.server";
import { getRequestSession } from "~/lib/auth/request-session.server";

async function readIdempotencyKey(request: Request): Promise<string | undefined> {
  const headerKey = request.headers.get("Idempotency-Key")?.trim();
  if (headerKey) return headerKey;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  try {
    const body = (await request.json()) as { idempotencyKey?: unknown };
    if (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) {
      return body.idempotencyKey.trim();
    }
  } catch {
    // Empty / non-JSON body is fine — re-embed historically accepted no body.
  }
  return undefined;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const session = await getRequestSession(request);
  if (!session?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const requestContext = getRequestContext(request);

  const courseId = params.courseId;
  if (!courseId) {
    return jsonResponse({ error: "Course ID is required" }, 400);
  }

  const idempotencyKey = await readIdempotencyKey(request);

  try {
    const course = await getCourseIfCanManageMaterials(session.user, courseId);
    if (!course) {
      return jsonResponse({ error: "Course not found or access denied" }, 404);
    }

    const { job, created, keyHonored } = await startReEmbedJob(courseId, { idempotencyKey });

    // Only a freshly-started job is a "created" event; reusing an active /
    // idempotent job is a no-op and must not be logged as a creation.
    if (created) {
      fireAndForget(
        logAuditAction({
          ...getActorContext(session?.user ?? null),
          ...requestContext,
          actionCode: "RE_EMBED_JOB_CREATED",
          category: "AI_CONFIG",
          entityType: "ReEmbedJob",
          entityId: job.id,
          details: { courseId, ...(idempotencyKey ? { idempotencyKey } : {}) },
        }),
      );
    }

    return jsonResponse(
      {
        success: true,
        job: serializeReEmbedJob(job),
        reusedExistingJob: !created,
        // False only when the caller supplied an Idempotency-Key that could
        // not be attached because the active job already belongs to a
        // different key (#1269 review) — the job above is still correct,
        // but a later retry on the caller's own key will not find it.
        ...(idempotencyKey ? { keyHonored } : {}),
      },
      created ? 202 : 200,
    );
  } catch (error) {
    console.error("[re-embed] API failed:", error);
    return jsonResponse(formatApiError(error), httpStatusForEnqueueError(error));
  }
}
