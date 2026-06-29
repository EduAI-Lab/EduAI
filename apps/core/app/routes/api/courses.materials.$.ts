/**
 * Course materials API. DELETE uses soft-delete (sets deletedAt/deletedBy).
 * One-way contract: material deletes are NEVER propagated to Canvas — Core owns the deletion.
 * Extensions may rely on deletedAt being set to detect EduAI-side removals.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { processMaterialEmbeddings } from '~/lib/ai/embedding';
import { processUploadedFile } from '~/lib/ai/file-processing';
import prisma from '~/lib/prisma.server';
import { auth } from '~/lib/auth/server';
import {
  resolveCourseAccessWithCourse,
  type AccessLevel,
} from '~/lib/auth/course-access.server';
import { getPolicy, denyByPolicy } from '~/lib/policy.server';
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
  const session = await auth.api.getSession({ headers: request.headers });
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
  const { user, access, isPublished } = resolved;

  const requestContext = getRequestContext(request);

  switch (request.method) {
    case 'POST': {
      // §7: upload is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
      // Students cannot upload materials UNLESS the students.canUploadMaterials
      // grant is explicitly enabled (off by default).
      const studentUploadAllowed =
        access.level === 'student' && (await getPolicy('students.canUploadMaterials'));
      if (access.rank < 1 && !studentUploadAllowed) {
        return denyByPolicy({
          request,
          policyKey: 'students.canUploadMaterials',
          user,
          action: 'material.upload',
          courseId,
        });
      }
      // §7/§19: a student may upload only in a PUBLISHED course — mirror the
      // list gate (loader 403s students in unpublished courses) so student
      // content can't be seeded into a draft course's RAG corpus. Higher ranks
      // legitimately work in unpublished courses. This is a publish-state gate,
      // NOT a policy-flag denial: the `students.canUploadMaterials` grant may be
      // on, so don't mislabel the audit trail with it — return a distinct 403.
      if (access.level === 'student' && !isPublished) {
        return json(403, { error: 'COURSE_NOT_PUBLISHED' });
      }
      // Gate: a TA is allowed by default; deny only when the gate is off.
      if (access.level === 'ta' && !(await getPolicy('tas.canManageMaterials'))) {
        return denyByPolicy({
          request,
          policyKey: 'tas.canManageMaterials',
          user,
          action: 'material.upload',
          courseId,
        });
      }
      return uploadMaterial(request, courseId, user, requestContext);
    }

    case 'PATCH':
    case 'PUT': {
      const materialId = params.materialId;
      if (!materialId) {
        return json(400, { error: 'MATERIAL_ID_REQUIRED' });
      }

      let body: { title?: unknown };
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'INVALID_BODY' });
      }
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!rawTitle) {
        return json(400, { error: 'TITLE_REQUIRED' });
      }
      if (rawTitle.length > 255) {
        return json(400, { error: 'TITLE_TOO_LONG' });
      }

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId, deletedAt: null },
        select: { id: true, uploadedBy: true, title: true },
      });
      if (!material) {
        return json(404, { error: 'MATERIAL_NOT_FOUND' });
      }

      // §7: rename mirrors delete — ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus
      // the TA own-only carve-out via uploadedBy. Null uploadedBy = no owner, TA denied.
      const isOwnTaRename = access.level === 'ta' && material.uploadedBy === user.id;
      if (access.rank < 2 && !isOwnTaRename) {
        return json(403, { error: 'Forbidden' });
      }

      const updated = await prisma.courseMaterial.update({
        where: { id: materialId },
        data: { title: rawTitle },
        select: { id: true, title: true },
      });

      fireAndForget(
        logAuditAction({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode: 'MATERIAL_RENAMED',
          category: 'MATERIAL',
          entityType: 'CourseMaterial',
          entityId: materialId,
          entityLabel: updated.title,
          details: { courseId, previousTitle: material.title, newTitle: updated.title },
        }),
      );

      return json(200, { success: true, material: updated });
    }

    case 'DELETE': {
      const materialId = params.materialId;
      if (!materialId) {
        return json(400, { error: 'MATERIAL_ID_REQUIRED' });
      }

      const material = await prisma.courseMaterial.findFirst({
        where: { id: materialId, courseId, deletedAt: null },
        select: { id: true, uploadedBy: true, title: true },
      });
      if (!material) {
        return json(404, { error: 'MATERIAL_NOT_FOUND' });
      }

      // tas.canManageMaterials is a single gate covering upload AND delete, so
      // an off flag must also block TA deletes (including own uploads).
      if (access.level === 'ta' && !(await getPolicy('tas.canManageMaterials'))) {
        return denyByPolicy({
          request,
          policyKey: 'tas.canManageMaterials',
          user,
          action: 'material.delete',
          courseId,
        });
      }

      // §7: delete is ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C), plus the TA
      // own-only carve-out via uploadedBy (#294). Null uploadedBy = no owner,
      // TA denied.
      const isOwnTa = access.level === 'ta' && material.uploadedBy === user.id;
      if (access.rank < 2 && !isOwnTa) {
        return json(403, { error: 'Forbidden' });
      }

      // Soft delete: set deletedAt and deletedBy. One-way: never propagated to Canvas.
      await prisma.courseMaterial.update({
        where: { id: materialId },
        data: { deletedAt: new Date(), deletedBy: user.id },
      });

      fireAndForget(
        logAuditAction({
          ...getActorContext(user ?? null),
          ...requestContext,
          actionCode: 'MATERIAL_DELETED',
          category: 'MATERIAL',
          entityType: 'CourseMaterial',
          entityId: materialId,
          entityLabel: material.title,
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
      // If the existing material is soft-deleted, restore it instead of 409.
      if (existingMaterial.deletedAt) {
        // Restore: clear deletedAt/deletedBy, reset status to PROCESSING, re-run embeddings.
        await prisma.courseMaterial.update({
          where: { id: existingMaterial.id },
          data: {
            deletedAt: null,
            deletedBy: null,
            status: 'PROCESSING',
            uploadedBy: user.id,
            processedAt: null,
          },
        });
        try {
          // Replace any stale chunks/embeddings from before the soft-delete so
          // restoring a material doesn't append duplicate RAG content (#685 review).
          await processMaterialEmbeddings(existingMaterial.id, fileInfo.content, {
            replace: true,
          });
          await prisma.courseMaterial.update({
            where: { id: existingMaterial.id },
            data: { status: 'READY', processedAt: new Date() },
          });
          return json(200, {
            success: true,
            materialId: existingMaterial.id,
            message: 'Material restored and processed successfully',
          });
        } catch (embeddingError) {
          await prisma.courseMaterial.update({
            where: { id: existingMaterial.id },
            data: { status: 'FAILED' },
          });
          throw embeddingError;
        }
      }
      // Not soft-deleted: it's a real duplicate.
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

    // Audit the upload as soon as the material row is persisted, independent of embedding.
    // A material that uploads successfully but later fails to embed is still a real upload
    // and must leave an audit trail (the embedding failure is recorded separately below).
    // actorUserId/actorRole come from getActorContext; email/name and the material's
    // type/size go in details so the audit line carries who-added-what in full.
    fireAndForget(
      logAuditAction({
        ...getActorContext(user ?? null),
        ...requestContext,
        actionCode: 'MATERIAL_UPLOADED',
        category: 'MATERIAL',
        entityType: 'CourseMaterial',
        entityId: material.id,
        entityLabel: material.title,
        details: {
          courseId,
          actorEmail: user.email,
          actorName: user.name,
          mimeType: material.mimeType,
          fileSize: material.fileSize,
        },
      }),
    );

    try {
      await processMaterialEmbeddings(material.id, fileInfo.content);

      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: 'READY', processedAt: new Date() },
      });

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
  const { user, access, isPublished } = resolved;

  // §7/§19: students can view materials only in published courses.
  if (access.level === 'student' && !isPublished) {
    return json(403, { error: 'Forbidden' });
  }

  // Policy gate (students.canViewMaterials, default true): layers on top of the
  // publish gate — off means students cannot list materials at all.
  if (access.level === 'student' && !(await getPolicy('students.canViewMaterials'))) {
    return denyByPolicy({
      request,
      policyKey: 'students.canViewMaterials',
      user,
      action: 'material.list',
      courseId,
    });
  }

  const materials = await prisma.courseMaterial.findMany({
    where: { courseId, deletedAt: null },
    include: {
      _count: { select: { chunks: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return json(200, {
    materials: materials.map(({ _count, ...material }) => ({
      ...material,
      chunkCount: _count?.chunks ?? 0,
    })),
  });
}
