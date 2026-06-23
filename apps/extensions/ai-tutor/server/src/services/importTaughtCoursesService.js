/**
 * Auto-imports Core courses the instructor teaches into local CourseOffering rows on login.
 * Uses Core GET /api/courses (session-scoped via buildCourseListFilter).
 */
import { prisma } from '../config/database.js';
import { listEduAiCourses } from './eduaiClient.js';
import { syncExternalCourseTopics } from './topicSync.js';
import { syncCourseEnrollments } from './enrollmentSync.js';

const AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR']);
const AUTO_ENROLL_ROLES = new Set(['STUDENT', 'TA']);
const TEACHING_ENROLLMENT_ROLES = new Set(['INSTRUCTOR', 'TA']);
const STUDENT_ENROLLMENT_ROLE = 'STUDENT';

function isTeachingCoreCourse(coreCourse) {
  return TEACHING_ENROLLMENT_ROLES.has(coreCourse?.callerEnrollmentRole);
}

function isStudentCoreCourse(coreCourse) {
  return (coreCourse?.callerEnrollmentRole ?? STUDENT_ENROLLMENT_ROLE) === STUDENT_ENROLLMENT_ROLE;
}

/** Ensures a Core-linked local offering exists and publish state matches Core. */
async function ensureOfferingFromCore(coreCourse) {
  const existing = await prisma.courseOffering.findFirst({
    where: {
      OR: [
        { coreOfferingId: coreCourse.id },
        { externalId: coreCourse.id, externalSource: 'EDUAI' },
      ],
    },
  });

  if (existing) {
    await syncOfferingPublishFromCore(coreCourse);
    if (!existing.coreOfferingId) {
      await prisma.courseOffering.update({
        where: { id: existing.id },
        data: { coreOfferingId: coreCourse.id },
      });
    }
    return existing;
  }

  return prisma.courseOffering.create({
    data: {
      title: deriveTitle(coreCourse),
      description: deriveDescription(coreCourse),
      externalId: coreCourse.id,
      coreOfferingId: coreCourse.id,
      isPublished: coreCourse.isPublished ?? false,
      externalSource: 'EDUAI',
      externalMetadata: coreCourse,
    },
  });
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

function corePublishState(externalCourse) {
  return typeof externalCourse?.isPublished === 'boolean' ? externalCourse.isPublished : null;
}

/** Applies Core isPublished to a linked local offering when Core reports an explicit boolean. */
async function syncOfferingPublishFromCore(externalCourse) {
  const publish = corePublishState(externalCourse);
  if (publish === null || !externalCourse?.id) {
    return false;
  }

  const offering = await prisma.courseOffering.findFirst({
    where: {
      OR: [
        { coreOfferingId: externalCourse.id },
        { externalId: externalCourse.id, externalSource: 'EDUAI' },
      ],
    },
  });

  if (!offering || offering.isPublished === publish) {
    return false;
  }

  await prisma.courseOffering.update({
    where: { id: offering.id },
    data: {
      isPublished: publish,
      externalMetadata: externalCourse,
    },
  });

  return true;
}

/**
 * Creates a CourseOffering for one Core course and syncs topics + enrollments.
 * Mirrors POST /api/courses/import-external without the HTTP layer.
 */
export async function importExternalCourseForUser(instructor, externalCourse) {
  const alreadyImported = await prisma.courseOffering.findFirst({
    where: {
      OR: [
        { coreOfferingId: externalCourse.id },
        { externalId: externalCourse.id, externalSource: 'EDUAI' },
      ],
    },
  });

  if (alreadyImported) {
    // Ensure the instructor is linked to the existing course (handles seeded courses
    // and courses already imported by another user).
    await prisma.courseInstructor.upsert({
      where: {
        userId_courseOfferingId: {
          userId: instructor.id,
          courseOfferingId: alreadyImported.id,
        },
      },
      create: { courseOfferingId: alreadyImported.id, userId: instructor.id, role: 'LEAD' },
      update: {},
    });

    // Backfill department so UNIT_ADMIN scoping works when course was seeded without it.
    if (
      !alreadyImported.department &&
      typeof externalCourse.department === 'string' &&
      externalCourse.department.trim()
    ) {
      await prisma.courseOffering.update({
        where: { id: alreadyImported.id },
        data: { department: externalCourse.department.trim() },
      });
    }

    // #477: backfill the Core offering link and mirror its publish state.
    if (!alreadyImported.coreOfferingId) {
      await prisma.courseOffering.update({
        where: { id: alreadyImported.id },
        data: { coreOfferingId: externalCourse.id },
      });
    }
    await syncOfferingPublishFromCore(externalCourse);

    return { offering: alreadyImported, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const offering = await tx.courseOffering.create({
      data: {
        title: deriveTitle(externalCourse),
        description: deriveDescription(externalCourse),
        externalId: externalCourse.id,
        coreOfferingId: externalCourse.id,
        isPublished: externalCourse.isPublished ?? false,
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
 * Mirrors Core course catalog into local offerings. Core is the source of truth —
 * imports new taught courses and refreshes topics + enrollments for existing links.
 * Idempotent — safe to call on every /api/me and GET /courses request.
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
      OR: [
        { externalId: { not: null } },
        { coreOfferingId: { not: null } },
      ],
      instructors: { some: { userId: instructor.id } },
    },
    select: { externalId: true, coreOfferingId: true },
  });

  const importedIds = new Set();
  for (const row of importedRows) {
    if (row.externalId) importedIds.add(row.externalId);
    if (row.coreOfferingId) importedIds.add(row.coreOfferingId);
  }

  let imported = 0;
  let skipped = 0;
  let publishSynced = 0;

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
      if (await syncOfferingPublishFromCore(coreCourse)) {
        publishSynced++;
      }
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

  let synced = 0;
  const offerings = await prisma.courseOffering.findMany({
    where: {
      instructors: { some: { userId: instructor.id } },
      externalSource: 'EDUAI',
      externalId: { not: null },
    },
  });

  for (const offering of offerings) {
    const [topicResult, enrollmentResult] = await Promise.allSettled([
      syncExternalCourseTopics(offering.id),
      syncCourseEnrollments(offering.id, { course: offering }),
    ]);

    if (topicResult.status === 'rejected') {
      console.error('[eduai] Topic sync failed for course', offering.id, topicResult.reason);
    }
    if (enrollmentResult.status === 'rejected') {
      console.error('[eduai] Enrollment sync failed for course', offering.id, enrollmentResult.reason);
    }
    if (topicResult.status === 'fulfilled' || enrollmentResult.status === 'fulfilled') {
      synced++;
    }
  }

  return { imported, skipped, synced, publishSynced };
}

/**
 * Mirrors Core student enrollments into local CourseEnrollment rows. Core is the
 * source of truth — creates offerings when missing and prunes stale EDUAI links.
 * Idempotent — safe to call on every /api/me and GET /courses request.
 */
export async function importEnrolledCoursesFromCore(student, cookie) {
  if (!AUTO_ENROLL_ROLES.has(student.role)) {
    return { enrolled: 0, skipped: 0, removed: 0 };
  }

  let coreCourses;
  try {
    coreCourses = await listEduAiCourses({ cookie });
  } catch (err) {
    console.error('[eduai] Student enrollment mirror skipped: could not list Core courses', err);
    return { enrolled: 0, skipped: 0, removed: 0, error: err.message };
  }

  if (!Array.isArray(coreCourses)) {
    return { enrolled: 0, skipped: 0, removed: 0 };
  }

  const studentCourses = coreCourses.filter(
    (course) => course?.id && typeof course.id === 'string' && isStudentCoreCourse(course),
  );

  let enrolled = 0;
  let skipped = 0;

  for (const coreCourse of studentCourses) {
    try {
      const offering = await ensureOfferingFromCore(coreCourse);
      await prisma.courseEnrollment.upsert({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: offering.id,
            userId: student.id,
          },
        },
        update: { role: STUDENT_ENROLLMENT_ROLE },
        create: {
          courseOfferingId: offering.id,
          userId: student.id,
          role: STUDENT_ENROLLMENT_ROLE,
        },
      });
      enrolled++;
    } catch (err) {
      console.error('[eduai] Student enrollment mirror failed for Core course', coreCourse.id, err);
      skipped++;
    }
  }

  const activeCoreIds = new Set(studentCourses.map((course) => course.id));

  // Guard: if Core returned no courses (deploy blip, permission hiccup, empty filter),
  // skip pruning to avoid deleting every mirrored student enrollment.
  if (activeCoreIds.size === 0) {
    return { enrolled, skipped, removed: 0 };
  }

  const localEnrollments = await prisma.courseEnrollment.findMany({
    where: { userId: student.id, role: STUDENT_ENROLLMENT_ROLE },
    include: {
      courseOffering: {
        select: { externalSource: true, externalId: true, coreOfferingId: true },
      },
    },
  });

  const staleOfferingIds = localEnrollments
    .filter((enrollment) => {
      const offering = enrollment.courseOffering;
      if (offering.externalSource !== 'EDUAI') return false;
      const coreId = offering.coreOfferingId ?? offering.externalId;
      return coreId && !activeCoreIds.has(coreId);
    })
    .map((enrollment) => enrollment.courseOfferingId);

  let removed = 0;
  if (staleOfferingIds.length > 0) {
    const result = await prisma.courseEnrollment.deleteMany({
      where: {
        userId: student.id,
        role: STUDENT_ENROLLMENT_ROLE,
        courseOfferingId: { in: staleOfferingIds },
      },
    });
    removed = result.count;
  }

  if (enrolled > 0 || removed > 0) {
    console.info(
      `[eduai] Student enrollment mirror for ${student.id}: ${enrolled} enrolled, ${removed} removed`,
    );
  }

  return { enrolled, skipped, removed };
}
