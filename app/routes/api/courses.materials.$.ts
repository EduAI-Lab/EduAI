import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { processMaterialEmbeddings } from '~/lib/ai/embedding';
import { processUploadedFile } from '~/lib/ai/file-processing';
import prisma from '~/lib/prisma.server';
import { auth } from '~/lib/auth/server';

export async function action({ request, params }: ActionFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = session.user;
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Check if user has access to this course
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      OR: [
        { professorId: user.id },
        { tas: { some: { userId: user.id } } },
        { enrollments: { some: { studentId: user.id, isActive: true } } }
      ]
    }
  });

  if (!course) {
    return new Response(JSON.stringify({ error: 'Course not found or access denied' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;
  const apiKeys = JSON.parse(formData.get('apiKeys') as string);

  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Process the uploaded file
    const fileInfo = await processUploadedFile(file);

    // Check if material with same checksum already exists for this course
    const existingMaterial = await prisma.courseMaterial.findFirst({
      where: {
        courseId,
        checksum: fileInfo.checksum
      }
    });

    if (existingMaterial) {
      return new Response(JSON.stringify({
        error: 'A file with identical content already exists in this course',
        materialId: existingMaterial.id
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create the course material
    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: fileInfo.title,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        checksum: fileInfo.checksum,
        rawText: fileInfo.content,
        status: 'PROCESSING'
      }
    });

    // Process embeddings in the background
    try {
      await processMaterialEmbeddings(material.id, fileInfo.content);

      // Update material status to ready
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: {
          status: 'READY',
          processedAt: new Date()
        }
      });

      return new Response(JSON.stringify({
        success: true,
        materialId: material.id,
        message: 'Material uploaded and processed successfully'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (embeddingError) {
      // Update material status to failed
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: {
          status: 'FAILED'
        }
      });

      throw embeddingError;
    }

  } catch (error) {
    console.error('Error processing material upload:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to process material'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const user = session.user;
  const courseId = params.courseId;

  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Course ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Check if user has access to this course
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      OR: [
        { professorId: user.id },
        { tas: { some: { userId: user.id } } },
        { enrollments: { some: { studentId: user.id, isActive: true } } }
      ]
    }
  });

  if (!course) {
    return new Response(JSON.stringify({ error: 'Course not found or access denied' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get materials for this course
  const materials = await prisma.courseMaterial.findMany({
    where: { courseId },
    include: {
      chunks: {
        include: {
          embedding: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return new Response(JSON.stringify({ materials }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}