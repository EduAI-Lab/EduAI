/**
 * Auto-imports Core courses the instructor teaches into local CourseOffering
 * anchor rows on login. Uses Core GET /api/courses (session-scoped via
 * buildCourseListFilter).
 *
 * #1072 step 3: `CourseOffering` is a pure anchor — this module only ever
 * provisions `{ coreOfferingId }` rows. `title` stays populated with the
 * Core id as a placeholder (the column is still `NOT NULL` until the step-4
 * migration drops it) but nothing reads it: every real field is
 * read-through via `mapCourseOffering`/`services/courseResolver.js`. No Core
 * field (title/description/department/dates/isPublished/externalMetadata)
 * is copied here anymore, and `reconcileOfferingFromCore` is gone entirely —
 * there is nothing left to reconcile once the row holds no Core-owned data.
 */
import { prisma } from '../config/database.js';
import { listEduAiCourses } from './eduaiClient.js';
import { syncExternalCourseTopics } from './topicSync.js';
import { syncCourseEnrollments } from './enrollmentSync.js';

const AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR']);
const AUTO_ENROLL_ROLES = new Set(['STUDENT', 'TA']);
const TEACHING_ENROLLMENT_ROLES = new Set(['INSTRUCTOR', 'TA']);
const STUDENT_ENROLLMENT_ROLE = 'STUDENT';
const TA_ENROLLMENT_ROLE = 'TA';

function isTeachingCoreCourse(coreCourse) {
  return TEACHING_ENROLLMENT_ROLES.has(coreCourse?.callerEnrollmentRole);
}

function isStudentCoreCourse(coreCourse) {
  return (coreCourse?.callerEnrollmentRole ?? STUDENT_ENROLLMENT_ROLE) === STUDENT_ENROLLMENT_ROLE;
}

function isTaCoreCourse(coreCourse) {
  return coreCourse?.callerEnrollmentRole === TA_ENROLLMENT_ROLE;
}

/**
 * Ensures a Core-linked local anchor row exists for one Core course. No Core
 * fields are copied onto it.
 */
async function ensureOfferingFromCore(coreCourse) {
  const existing = await prisma.courseOffering.findFirst({
    where: { coreOfferingId: coreCourse.id },
  });

  if (existing) {
    return existing;
  }

  return prisma.courseOffering.create({
    data: {
      // `title` is NOT NULL until the step-4 migration drops it; the Core id
      // is a harmless placeholder that nothing reads (read-through via
      // `mapCourseOffering` always prefers the resolved Core course's name).
      title: coreCourse.id,
      coreOfferingId: coreCourse.id,
    },
  });
}

/**
 * Ensures a local anchor row exists for every id in `coreCourseIds`, in one
 * batched read + one batched insert — never a per-course round trip. Backs
 * the ADMIN course list's create-on-open behavior (#1072 step 3 / #1074): by
 * the time the list response is built, every course in Core's catalog —
 * including ones no instructor has ever logged in to auto-import — has a
 * stable local id the client can link into.
 */
export async function ensureOfferingAnchors(coreCourseIds) {
  const ids = Array.from(
    new Set((coreCourseIds ?? []).filter((id) => typeof id === 'string' && id)),
  );
  if (ids.length === 0) return;

  const existing = await prisma.courseOffering.findMany({
    where: { coreOfferingId: { in: ids } },
    select: { coreOfferingId: true },
  });
  const existingIds = new Set(existing.map((o) => o.coreOfferingId));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length === 0) return;

  await prisma.courseOffering.createMany({
    data: missing.map((id) => ({ title: id, coreOfferingId: id })),
    skipDuplicates: true,
  });
}

/**
 * Creates a CourseOffering anchor for one Core course and syncs topics +
 * enrollments. Mirrors POST /api/courses/import-external without the HTTP layer.
 */
export async function importExternalCourseForUser(instructor, externalCourse) {
  const alreadyImported = await prisma.courseOffering.findFirst({
    where: { coreOfferingId: externalCourse.id },
  });

  if (alreadyImported) {
    // Ensure the instructor is linked to the existing course (handles seeded
    // courses and courses already imported by another user).
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

    return { offering: alreadyImported, created: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    const offering = await tx.courseOffering.create({
      data: {
        title: externalCourse.id,
        coreOfferingId: externalCourse.id,
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
 * Mirrors Core's course catalog into local offering anchors. Core is the
 * source of truth for every real field — imports new taught courses (anchor
 * row only) and refreshes topics + enrollments for existing links.
 * Idempotent — safe to call on every /api/me and GET /courses request.
 *
 * Pass `options.coreCourses` when the caller already fetched Core's course list
 * (e.g. `/api/me` shares one list across import + TA role resolution).
 */
export async function importTaughtCoursesFromCore(instructor, cookie, options = {}) {
  if (!AUTO_IMPORT_ROLES.has(instructor.role)) {
    return { imported: 0, skipped: 0 };
  }

  let coreCourses = options.coreCourses;
  if (coreCourses === undefined) {
    try {
      coreCourses = await listEduAiCourses({ cookie });
    } catch (err) {
      console.error('[eduai] Auto-import skipped: could not list Core courses', err);
      return { imported: 0, skipped: 0, error: err.message };
    }
  }

  if (!Array.isArray(coreCourses) || coreCourses.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const importedRows = await prisma.courseOffering.findMany({
    where: {
      coreOfferingId: { not: null },
      instructors: { some: { userId: instructor.id } },
    },
    select: { coreOfferingId: true },
  });

  const importedIds = new Set(importedRows.map((row) => row.coreOfferingId).filter(Boolean));

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

  let synced = 0;
  const offerings = await prisma.courseOffering.findMany({
    where: {
      instructors: { some: { userId: instructor.id } },
      coreOfferingId: { not: null },
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

  return { imported, skipped, synced };
}

/**
 * Mirrors Core student enrollments into local CourseEnrollment rows. Core is the
 * source of truth — creates offering anchors when missing and prunes stale
 * Core-linked enrollments.
 * Idempotent — safe to call on every /api/me and GET /courses request.
 *
 * Pass `options.coreCourses` when the caller already fetched Core's course list.
 */
export async function importEnrolledCoursesFromCore(student, cookie, options = {}) {
  if (!AUTO_ENROLL_ROLES.has(student.role)) {
    return { enrolled: 0, skipped: 0, removed: 0 };
  }

  let coreCourses = options.coreCourses;
  if (coreCourses === undefined) {
    try {
      coreCourses = await listEduAiCourses({ cookie });
    } catch (err) {
      console.error('[eduai] Student enrollment mirror skipped: could not list Core courses', err);
      return { enrolled: 0, skipped: 0, removed: 0, error: err.message };
    }
  }

  if (!Array.isArray(coreCourses)) {
    return { enrolled: 0, skipped: 0, removed: 0 };
  }

  const studentCourses = coreCourses.filter(
    (course) => course?.id && typeof course.id === 'string' && isStudentCoreCourse(course),
  );
  const taCourses = coreCourses.filter(
    (course) => course?.id && typeof course.id === 'string' && isTaCoreCourse(course),
  );

  let enrolled = 0;
  let skipped = 0;

  for (const coreCourse of taCourses) {
    try {
      const offering = await ensureOfferingFromCore(coreCourse);
      await prisma.courseEnrollment.upsert({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: offering.id,
            userId: student.id,
          },
        },
        update: { role: TA_ENROLLMENT_ROLE },
        create: {
          courseOfferingId: offering.id,
          userId: student.id,
          role: TA_ENROLLMENT_ROLE,
        },
      });
      enrolled++;
    } catch (err) {
      console.error('[eduai] TA enrollment mirror failed for Core course', coreCourse.id, err);
      skipped++;
    }
  }

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
        select: { coreOfferingId: true },
      },
    },
  });

  const staleOfferingIds = localEnrollments
    .filter((enrollment) => {
      const coreId = enrollment.courseOffering.coreOfferingId;
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

export function coreCoursesIncludeTaEnrollment(coreCourses) {
  if (!Array.isArray(coreCourses)) return false;
  return coreCourses.some((course) => course?.callerEnrollmentRole === 'TA');
}

/**
 * True when Core reports the caller holds a TA enrollment in any course.
 *
 * Core's TA-on-Enrollment migration (#664) dropped the platform-level
 * UserRole.TA: a course TA is now a STUDENT-platform user with an
 * Enrollment(role=TA). AI Tutor's client RBAC still selects its role *view*
 * (nav, route shell, access level) from a single role string, so `/api/me`
 * uses this to surface an effective TA role. Core's per-course
 * `callerEnrollmentRole` is the source of truth — the local mirror flattens
 * student-side enrollments to STUDENT and cannot be trusted for this.
 *
 * Pass `coreCourses` when the caller already fetched Core's course list.
 */
export async function userHasCoreTaEnrollment(cookie, coreCourses) {
  const courses =
    coreCourses !== undefined ? coreCourses : await listEduAiCourses({ cookie });
  return coreCoursesIncludeTaEnrollment(courses);
}
