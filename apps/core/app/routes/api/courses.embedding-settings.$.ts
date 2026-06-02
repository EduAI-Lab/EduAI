import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import prisma from "~/lib/prisma.server";
import {
  ALLOWED_CLOUD_EMBEDDING_MODELS,
  ALLOWED_LOCAL_EMBEDDING_MODELS,
  clearCourseEmbeddingSettingsCache,
  isEmbeddingIndexStale,
  parseEmbeddingSettingsUpdate,
  reEmbedCourseMaterials,
  resolveEffectiveEmbeddingSettings,
  validateEmbeddingSettingsUpdate,
} from "~/lib/ai/embedding";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireManageSession(request: Request) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return { error: apiKeyGuard };

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  return { session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authResult = await requireManageSession(request);
  if ("error" in authResult && authResult.error) return authResult.error;

  const courseId = params.courseId;
  if (!courseId) {
    return json({ error: "Course ID is required" }, 400);
  }

  const course = await getCourseIfCanManageMaterials(authResult.session!.user, courseId);
  if (!course) {
    return json({ error: "Course not found or access denied" }, 404);
  }

  const fields = {
    embeddingProvider: course.embeddingProvider,
    embeddingModel: course.embeddingModel,
    embeddedWithProvider: course.embeddedWithProvider,
    embeddedWithModel: course.embeddedWithModel,
    lastEmbeddedAt: course.lastEmbeddedAt,
  };

  const effective = resolveEffectiveEmbeddingSettings(fields);

  return json({
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
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireManageSession(request);
  if ("error" in authResult && authResult.error) return authResult.error;

  const courseId = params.courseId;
  if (!courseId) {
    return json({ error: "Course ID is required" }, 400);
  }

  const course = await getCourseIfCanManageMaterials(authResult.session!.user, courseId);
  if (!course) {
    return json({ error: "Course not found or access denied" }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseEmbeddingSettingsUpdate(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
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
    return json({ error: validated.error }, 400);
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
  const effective = resolveEffectiveEmbeddingSettings(fields);

  let reEmbedResult: { processed: number; failed: string[] } | undefined;
  if (reEmbedAfterSave) {
    reEmbedResult = await reEmbedCourseMaterials(courseId);
  }

  const refreshed = reEmbedResult
    ? await prisma.course.findUniqueOrThrow({
        where: { id: courseId },
        select: {
          embeddingProvider: true,
          embeddingModel: true,
          embeddedWithProvider: true,
          embeddedWithModel: true,
          lastEmbeddedAt: true,
        },
      })
    : fields;

  return json({
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
    reEmbed: reEmbedResult,
  });
}
