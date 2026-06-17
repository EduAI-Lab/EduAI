import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import prisma from "~/lib/prisma.server";
import { formatApiError, jsonResponse } from "~/lib/api/json-response.server";
import {
  ALLOWED_CLOUD_EMBEDDING_MODELS,
  ALLOWED_LOCAL_EMBEDDING_MODELS,
  clearCourseEmbeddingSettingsCache,
  isEmbeddingIndexStale,
  parseEmbeddingSettingsUpdate,
  resolveEffectiveEmbeddingSettings,
  validateEmbeddingSettingsUpdate,
} from "~/lib/ai/embedding";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

async function requireManageSession(request: Request) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return { error: apiKeyGuard };

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return { error: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  return { session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const authResult = await requireManageSession(request);
    if ("error" in authResult && authResult.error) return authResult.error;

    const courseId = params.courseId;
    if (!courseId) {
      return jsonResponse({ error: "Course ID is required" }, 400);
    }

    const course = await getCourseIfCanManageMaterials(authResult.session!.user, courseId);
    if (!course) {
      return jsonResponse({ error: "Course not found or access denied" }, 404);
    }

    const fields = {
      embeddingProvider: course.embeddingProvider,
      embeddingModel: course.embeddingModel,
      embeddedWithProvider: course.embeddedWithProvider,
      embeddedWithModel: course.embeddedWithModel,
      lastEmbeddedAt: course.lastEmbeddedAt,
    };

    const effective = resolveEffectiveEmbeddingSettings(fields);

    return jsonResponse({
      settings: {
        embeddingProvider: course.embeddingProvider,
        embeddingModel: course.embeddingModel,
        embeddedWithProvider: course.embeddedWithProvider,
        embeddedWithModel: course.embeddedWithModel,
        lastEmbeddedAt: course.lastEmbeddedAt,
      },
      effective,
      needsReEmbed: isEmbeddingIndexStale(fields, effective),
      allowedLocalModels: ALLOWED_LOCAL_EMBEDDING_MODELS,
      allowedCloudModels: ALLOWED_CLOUD_EMBEDDING_MODELS,
    });
  } catch (error) {
    console.error("[embedding-settings] GET failed:", error);
    return jsonResponse(formatApiError(error), 500);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
  const requestContext = getRequestContext(request);
  const authResult = await requireManageSession(request);
  if ("error" in authResult && authResult.error) return authResult.error;

  const courseId = params.courseId;
  if (!courseId) {
    return jsonResponse({ error: "Course ID is required" }, 400);
  }

  const course = await getCourseIfCanManageMaterials(authResult.session!.user, courseId);
  if (!course) {
    return jsonResponse({ error: "Course not found or access denied" }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseEmbeddingSettingsUpdate(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  const record = body as Record<string, unknown>;
  const reEmbedAfterSave = record.reEmbed === true;

  const current = {
    embeddingProvider: course.embeddingProvider,
    embeddingModel: course.embeddingModel,
    embeddedWithProvider: course.embeddedWithProvider,
    embeddedWithModel: course.embeddedWithModel,
    lastEmbeddedAt: course.lastEmbeddedAt,
  };

  const validated = validateEmbeddingSettingsUpdate(current, parsed.value);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      embeddingProvider: validated.value.embeddingProvider,
      embeddingModel: validated.value.embeddingModel,
    },
  });

  clearCourseEmbeddingSettingsCache(courseId);

  const fields = {
    embeddingProvider: updated.embeddingProvider,
    embeddingModel: updated.embeddingModel,
    embeddedWithProvider: updated.embeddedWithProvider,
    embeddedWithModel: updated.embeddedWithModel,
    lastEmbeddedAt: updated.lastEmbeddedAt,
  };

  let reEmbedJob:
    | Awaited<ReturnType<typeof import("~/lib/ai/re-embed-job.server").serializeReEmbedJob>>
    | undefined;
  if (reEmbedAfterSave) {
    const { startReEmbedJob, serializeReEmbedJob } = await import(
      "~/lib/ai/re-embed-job.server"
    );
    const job = await startReEmbedJob(courseId);
    reEmbedJob = serializeReEmbedJob(job);

    // A re-embed started through the settings PATCH must be audited the same way
    // the dedicated /re-embed route audits it, so this path is not a coverage gap.
    fireAndForget(
      logAuditAction({
        ...getActorContext(authResult.session?.user ?? null),
        ...requestContext,
        actionCode: "RE_EMBED_JOB_CREATED",
        category: "AI_CONFIG",
        entityType: "ReEmbedJob",
        entityId: job.id,
        details: { courseId },
      }),
    );
  }

  const refreshed = fields;

  // Only audit a real change: a PATCH that resubmits the existing provider/model is a no-op
  // and must not produce an EMBEDDING_SETTINGS_CHANGED event that didn't actually change anything.
  const settingsChanged =
    current.embeddingProvider !== updated.embeddingProvider ||
    current.embeddingModel !== updated.embeddingModel;

  if (settingsChanged) {
    fireAndForget(
      logAuditAction({
        ...getActorContext(authResult.session?.user ?? null),
        ...requestContext,
        actionCode: "EMBEDDING_SETTINGS_CHANGED",
        category: "AI_CONFIG",
        entityType: "Course",
        entityId: courseId,
        details: {
          previousProvider: current.embeddingProvider,
          previousModel: current.embeddingModel,
          embeddingProvider: updated.embeddingProvider,
          embeddingModel: updated.embeddingModel,
        },
      }),
    );
  }

  return jsonResponse({
    success: true,
    settings: {
      embeddingProvider: refreshed.embeddingProvider,
      embeddingModel: refreshed.embeddingModel,
      embeddedWithProvider: refreshed.embeddedWithProvider,
      embeddedWithModel: refreshed.embeddedWithModel,
      lastEmbeddedAt: refreshed.lastEmbeddedAt,
    },
    effective: resolveEffectiveEmbeddingSettings(refreshed),
    needsReEmbed: isEmbeddingIndexStale(
      refreshed,
      resolveEffectiveEmbeddingSettings(refreshed),
    ),
    allowedLocalModels: ALLOWED_LOCAL_EMBEDDING_MODELS,
    allowedCloudModels: ALLOWED_CLOUD_EMBEDDING_MODELS,
    reEmbedJob,
  });
  } catch (error) {
    console.error("[embedding-settings] PATCH failed:", error);
    return jsonResponse(formatApiError(error), 500);
  }
}
