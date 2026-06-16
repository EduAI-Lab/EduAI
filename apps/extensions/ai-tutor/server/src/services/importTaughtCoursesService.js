/**
 * Auto-imports Core courses the instructor teaches into local CourseOffering rows on login.
 * Uses Core GET /api/courses (session-scoped via buildCourseListFilter).
 */
import { prisma } from '../config/database.js';
import { listEduAiCourses } from './eduaiClient.js';
import { syncExternalCourseTopics } from './topicSync.js';
import { syncCourseEnrollments } from './enrollmentSync.js';

const AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR']);
const TEACHING_ENROLLMENT_ROLES = new Set(['INSTRUCTOR', 'TA']);

function isTeachingCoreCourse(coreCourse) {
  return TEACHING_ENROLLMENT_ROLES.has(coreCourse?.callerEnrollmentRole);
}

function deriveTitle(externalCourse) {
  const titleParts = [
    typeof externalCourse.code === 'string' ? externalCourse.code.trim() : null,
    typeof externalCourse.name === 'string' ? externalCourse.name.trim() : null,
  ].filter(Boolean);

  return (
    titleParts.join(' - ') ||
    (typeof externalCourse.name === 'string' ? externalCourse.name : null) ||
    (typeof externalCourse.code === 'string' ? externalCourse.code : null) ||
    'Imported Course'
  );
}

function deriveDescription(externalCourse) {
  if (typeof externalCourse.description === 'string' && externalCourse.description.trim()) {
    return externalCourse.description;
  }
  return [externalCourse.term, externalCourse.year].filter(Boolean).join(' ') || null;
}

/**
 * Creates a CourseOffering for one Core course and syncs topics + enrollments.
 * Mirrors POST /api/courses/import-external without the HTTP layer.
 */
export async function importExternalCourseForUser(instructor, externalCourse) {
  const alreadyImported = await prisma.courseOffering.findFirst({
    where: {
      externalId: externalCourse.id,
      instructors: { some: { userId: instructor.id } },
    },
  });

  if (alreadyImported) {
    return { offering: alreadyImported, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const offering = await tx.courseOffering.create({
      data: {
        title: deriveTitle(externalCourse),
        description: deriveDescription(externalCourse),
        externalId: externalCourse.id,
        externalSource: 'EDUAI',
        externalMetadata: externalCourse,
      },
    });

    await tx.courseInstructor.create({
      data: {
        courseOfferingId: offering.id,
        userId: instructor.id,
        role: 'LEAD',
      },
    });

    return offering;
  });

  const [topicResult, enrollmentResult] = await Promise.allSettled([
    syncExternalCourseTopics(created.id),
    syncCourseEnrollments(created.id),
  ]);

  if (topicResult.status === 'rejected') {
    console.error('[eduai] Failed to sync topics for auto-imported course', topicResult.reason);
  }
  if (enrollmentResult.status === 'rejected') {
    console.error('[eduai] Failed to sync enrollments for auto-imported course', enrollmentResult.reason);
  }

  return { offering: created, created: true };
}

/**
 * Imports all Core courses the instructor teaches that are not yet imported locally.
 * Idempotent — safe to call on every /api/me request.
 */
export async function importTaughtCoursesFromCore(instructor, cookie) {
  if (!AUTO_IMPORT_ROLES.has(instructor.role)) {
    return { imported: 0, skipped: 0 };
  }

  let coreCourses;
  try {
    coreCourses = await listEduAiCourses({ cookie });
  } catch (err) {
    console.error('[eduai] Auto-import skipped: could not list Core courses', err);
    return { imported: 0, skipped: 0, error: err.message };
  }

  if (!Array.isArray(coreCourses) || coreCourses.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const importedRows = await prisma.courseOffering.findMany({
    where: {
      externalSource: 'EDUAI',
      externalId: { not: null },
      instructors: { some: { userId: instructor.id } },
    },
    select: { externalId: true },
  });

  const importedIds = new Set(importedRows.map((row) => row.externalId).filter(Boolean));

  let imported = 0;
  let skipped = 0;

  for (const coreCourse of coreCourses) {
    if (!coreCourse?.id || typeof coreCourse.id !== 'string') {
      skipped++;
      continue;
    }

    if (!isTeachingCoreCourse(coreCourse)) {
      skipped++;
      continue;
    }

    if (importedIds.has(coreCourse.id)) {
      skipped++;
      continue;
    }

    try {
      const result = await importExternalCourseForUser(instructor, coreCourse);
      importedIds.add(coreCourse.id);
      if (result.created) {
        imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error('[eduai] Auto-import failed for Core course', coreCourse.id, err);
      skipped++;
    }
  }

  if (imported > 0) {
    console.info(`[eduai] Auto-imported ${imported} taught course(s) for instructor ${instructor.id}`);
  }

  return { imported, skipped };
}
