import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { processMaterialEmbeddings } from '~/lib/ai/embedding';
import { processUploadedFile } from '~/lib/ai/file-processing';
import prisma from '~/lib/prisma.server';
import { auth } from '~/lib/auth/server';
import { enforceAdminIfApiKey } from '~/lib/auth/guards.server';

export async function action({ request, params }: ActionFunctionArgs) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const user = session.user;
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO(RBAC #292): replace with resolveCourseAccess
  const isAdmin = user.role === 'ADMIN' || user.role === 'UNIT_ADMIN';
  const course = await prisma.course.findFirst({
    where: isAdmin
      ? { id: courseId, deletedAt: null }
      : { id: courseId, deletedAt: null, enrollments: { some: { userId: user.id, isActive: true } } },
    select: { id: true },
  });

  if (!course) {
    return new Response(JSON.stringify({ error: 'Course not found or access denied' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;
  const apiKeys = JSON.parse(formData.get('apiKeys') as string);

  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const fileInfo = await processUploadedFile(file);

    const existingMaterial = await prisma.courseMaterial.findFirst({
      where: { courseId, checksum: fileInfo.checksum },
    });

    if (existingMaterial) {
      return new Response(JSON.stringify({
        error: 'A file with identical content already exists in this course',
        materialId: existingMaterial.id,
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
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
      },
    });

    try {
      await processMaterialEmbeddings(material.id, fileInfo.content);

      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: 'READY', processedAt: new Date() },
      });

      return new Response(JSON.stringify({
        success: true,
        materialId: material.id,
        message: 'Material uploaded and processed successfully',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (embeddingError) {
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: 'FAILED' },
      });
      throw embeddingError;
    }

  } catch (error) {
    console.error('Error processing material upload:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to process material',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { response: apiKeyGuard, session: apiKeySession } = await enforceAdminIfApiKey(request);
  if (apiKeyGuard) return apiKeyGuard;

  const session = apiKeySession ?? await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const user = session.user;
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO(RBAC #292): replace with resolveCourseAccess
  const isAdmin = user.role === 'ADMIN' || user.role === 'UNIT_ADMIN';
  const course = await prisma.course.findFirst({
    where: isAdmin
      ? { id: courseId, deletedAt: null }
      : { id: courseId, deletedAt: null, enrollments: { some: { userId: user.id, isActive: true } } },
    select: { id: true },
  });

  if (!course) {
    return new Response(JSON.stringify({ error: 'Course not found or access denied' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
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

  return new Response(JSON.stringify({ materials }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
