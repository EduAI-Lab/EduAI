import type { ActionFunctionArgs } from "react-router";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { jsonResponse } from "~/lib/api/json-response.server";
import { serializeReEmbedJob, startOrResumeReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { z } from "zod";
import { withErrorResponse } from "~/lib/errors.server";

async function readIdempotencyKey(request: Request): Promise<string | undefined> {
  const headerKey = request.headers.get("Idempotency-Key")?.trim();
  if (headerKey) return headerKey;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  try {
    const body = (await request.json()) as { idempotencyKey?: unknown };
    const idempotencyKey = z.string().trim().min(1).safeParse(body.idempotencyKey);
    if (idempotencyKey.success) {
      return idempotencyKey.data;
    }
  } catch {
    // Empty / non-JSON body is fine — re-embed historically accepted no body.
  }
  return undefined;
}

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
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

      const course = await getCourseIfCanManageMaterials(session.user, courseId);
      if (!course) {
        return jsonResponse({ error: "Course not found or access denied" }, 404);
      }

      // A DB/queue outage surfaces as a typed `QueueUnavailableError` from
      // `startOrResumeReEmbedJob` (#1112), which the boundary mapper turns into a
      // 503 — so this route no longer catches and re-classifies infra failures,
      // and an unexpected throw maps to a generic 500 without leaking its message.
      const { job, created, keyHonored } = await startOrResumeReEmbedJob(courseId, {
        idempotencyKey,
      });

      // Only a freshly-started job is a "created" event; reusing an active job is
      // a no-op and must not be logged as a creation.
      if (created) {
        fireAndForget(
          logAuditAction({
            ...getActorContext(session?.user ?? null),
            ...requestContext,
            actionCode: "RE_EMBED_JOB_CREATED",
            category: "AI_CONFIG",
            entityType: "ReEmbedJob",
            entityId: job.id,
            details: { courseId, idempotencyKey: idempotencyKey || undefined },
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
          // but a later retry on the caller's own key will not find it. A caller
          // that sent no key gets no verdict, so the field is absent for them.
          keyHonored: idempotencyKey ? keyHonored : undefined,
        },
        created ? 202 : 200,
      );
    },
    { request },
  );
}
