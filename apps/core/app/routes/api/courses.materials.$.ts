import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { processMaterialEmbeddings } from '~/lib/ai/embedding';
import { processUploadedFile } from '~/lib/ai/file-processing';
import prisma from '~/lib/prisma.server';
import { auth } from '~/lib/auth/server';
import { enforceAdminIfApiKey } from '~/lib/auth/guards.server';
import {
  resolveCourseAccessWithCourse,
  type AccessLevel,
} from '~/lib/auth/course-access.server';
import type { Session } from '~/lib/auth/server';
import { fireAndForget, logAuditAction, logSystemError } from '~/lib/logging.server';
import { getActorContext, getRequestContext } from '~/lib/request-context.server';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Shared auth resolution for all material routes: session + §7 course access.
 * Returns a Response on failure, or the session user + access on success.
 */
async function resolveMaterialsAccess(
  request: Request,
  courseId: string,
): Promise<
  | { response: Response; user?: never; access?: never; isPublished?: never }
  | { response?: never; user: Session['user']; access: AccessLevel; isPublished: boolean }
> {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return { response: apiKeyGuard };

  const session = apiKeySession ?? (await auth.api.getSession(request));
  if (!session?.user) {
    return { response: json(401, { error: 'Unauthorized' }) };
  }

  const { course, access } = await resolveCourseAccessWithCourse(session.user, courseId);
  if (!course) {
    return { response: json(404, { error: 'COURSE_NOT_FOUND' }) };
  }
  if (!access) {
    return { response: json(403, { error: 'Forbidden' }) };
  }

  return { user: session.user, access, isPublished: course.isPublished };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { error: 'Course ID is required' });
  }

  const resolved = await resolveMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;
  const { user, access } = resolved;

  const requestContext = getRequestContext(request);

  switch (request.method) {
    case 'POST': {
      // §7: upload is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
      // Students cannot upload materials.
      if (access.rank < 1) {
        return json(403, { error: 'Forbidden' });
      }
      return uploadMaterial(request, courseId, user, requestContext);
    }

    case 'DELETE': {
      const materialId = params.materialId;
      if (!materialId) {
        return json(400, { error: 'MATERIAL_ID_REQUIRED' });
      }

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId },
        select: { id: true, uploadedBy: true },
      });
      if (!material) {
        return json(404, { error: 'MATERIAL_NOT_FOUND' });
      }

      // §7: delete is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus the TA
      // own-only carve-out via uploadedBy (#294). Null uploadedBy = no owner,
      // TA denied.
      const isOwnTa = access.level === 'ta' && material.uploadedBy === user.id;
      if (access.rank < 2 && !isOwnTa) {
        return json(403, { error: 'Forbidden' });
      }

      // Hard delete — CourseMaterial has no deletedAt; chunks cascade.
      await prisma.courseMaterial.delete({ where: { id: materialId } });

      fireAndForget(
        logAuditAction({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode: 'MATERIAL_DELETED',
          category: 'MATERIAL',
          entityType: 'CourseMaterial',
          entityId: materialId,
          details: { courseId },
        }),
      );

      return new Response(null, { status: 204 });
    }

    default:
      return json(405, { error: 'Method not allowed' });
  }
}

async function uploadMaterial(
  request: Request,
  courseId: string,
  user: Session['user'],
  requestContext: ReturnType<typeof getRequestContext>,
) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const apiKeys = JSON.parse(formData.get('apiKeys') as string);

  if (!file) {
    return json(400, { error: 'No file provided' });
  }

  try {
    const fileInfo = await processUploadedFile(file);

    const existingMaterial = await prisma.courseMaterial.findFirst({
      where: { courseId, checksum: fileInfo.checksum },
    });

    if (existingMaterial) {
      return json(409, {
        error: 'A file with identical content already exists in this course',
        materialId: existingMaterial.id,
      });
    }

    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: fileInfo.title,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        checksum: fileInfo.checksum,
        rawText: fileInfo.content,
        status: 'PROCESSING',
        uploadedBy: user.id, // #294: owner FK for TA own-only delete (§7)
      },
    });

    try {
      await processMaterialEmbeddings(material.id, fileInfo.content);

      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: 'READY', processedAt: new Date() },
      });

      fireAndForget(
        logAuditAction({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode: 'MATERIAL_UPLOADED',
          category: 'MATERIAL',
          entityType: 'CourseMaterial',
          entityId: material.id,
          entityLabel: fileInfo.title,
          details: { courseId },
        }),
      );

      return json(200, {
        success: true,
        materialId: material.id,
        message: 'Material uploaded and processed successfully',
      });

    } catch (embeddingError) {
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: 'FAILED' },
      });
      fireAndForget(
        logSystemError({
          ...requestContext,
          source: 'AI',
          code: 'MATERIAL_EMBED_FAILED',
          message: 'Material embedding failed during upload processing',
          error: embeddingError,
        }),
      );
      throw embeddingError;
    }

  } catch (error) {
    console.error('Error processing material upload:', error);
    return json(500, {
      error: error instanceof Error ? error.message : 'Failed to process material',
    });
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { error: 'Course ID is required' });
  }

  const resolved = await resolveMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;
  const { access, isPublished } = resolved;

  // §7/§19: students can view materials only in published courses.
  if (access.level === 'student' && !isPublished) {
    return json(403, { error: 'Forbidden' });
  }

  const materials = await prisma.courseMaterial.findMany({
    where: { courseId },
    include: {
      chunks: {
        include: { embedding: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return json(200, { materials });
}
