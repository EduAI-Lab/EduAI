/**
 * Auto-imports Core courses the instructor teaches into the local QM library on login.
 * Uses Core GET /api/courses (session-scoped via buildCourseListFilter).
 */
import { Op } from 'sequelize';
import { Course, Topics, Assessments } from '../schema/index.js';
import { listCoursesFromCore, getCourseEnrollmentsFromCore } from './coreApiService.js';
import { syncTopicsFromCoreForCourse } from './topicSyncService.js';
import { createAssessment } from './assessmentService.js';
import { logger } from '../utils/logger.js';

const AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR']);
const TEACHING_ENROLLMENT_ROLES = new Set(['INSTRUCTOR', 'TA']);

function isTeachingCoreCourse(coreCourse) {
  return TEACHING_ENROLLMENT_ROLES.has(coreCourse?.callerEnrollmentRole);
}

async function ensurePracticeExam(userId, courseId) {
  try {
    // Idempotent: provisioning now runs for pre-existing anchors too (e.g. one
    // materialized by an ADMIN course-list visit, #1074), not just freshly
    // created ones — never create a second Practice Exam for the course.
    const existing = await Assessments.findOne({
      where: { courseId, name: 'Practice Exam' },
    });
    if (existing) return;

    // Semester is derived from the course's Core term (#1072 §4 step 8 / #1077),
    // not passed here.
    await createAssessment(userId, {
      type: 'Quiz',
      name: 'Practice Exam',
      description: '',
      courseId,
      blueprintConfig: null,
    });
  } catch (err) {
    logger.warn({ err, courseId }, 'Practice Exam creation skipped during auto-import');
  }
}

/**
 * Course-scoped provisioning that must hold for every taught anchor no matter
 * who created it: Core topics synced (with a 'General' fallback) and a
 * Practice Exam present. Safe to run repeatedly.
 */
async function provisionCourse(userId, course, cookie) {
  await syncTopicsFromCoreForCourse(course, cookie);

  const topics = await Topics.findAll({ where: { courseId: course.id } });
  if (topics.length === 0) {
    await Topics.create({ name: 'General', courseId: course.id });
  }

  await ensurePracticeExam(userId, course.id);
}

/**
 * An anchor can pre-exist under ANOTHER user's id — an ADMIN opening the
 * course list materializes catalog anchors under their own userId (#1074).
 * If the current owner holds no active teaching enrollment in Core, transfer
 * ownership to the importing instructor: ownership is the Core-down access
 * fallback (`courseAccess.resolveAccessForCourse`), and an ADMIN never needs
 * it (their role short-circuits access). If the owner IS a teaching
 * co-instructor/TA, leave ownership alone — first import wins, both keep
 * enrollment-based access while Core is up.
 */
async function maybeClaimAnchor(userId, course) {
  let roster = [];
  try {
    const data = await getCourseEnrollmentsFromCore(course.coreCourseId, {});
    roster = data?.enrollments ?? [];
  } catch (err) {
    // Can't tell who the owner is — keep ownership as-is (conservative).
    logger.warn(
      { err, userId, coreCourseId: course.coreCourseId },
      'Anchor claim check skipped: could not read Core roster',
    );
    return;
  }

  const ownerTeaches = roster.some(
    (e) =>
      e.studentId === course.userId &&
      e.isActive &&
      TEACHING_ENROLLMENT_ROLES.has(e.role),
  );
  if (!ownerTeaches) {
    await course.update({ userId });
    logger.info(
      { userId, courseId: course.id, coreCourseId: course.coreCourseId },
      'Claimed course anchor from non-teaching owner during auto-import',
    );
  }
}

/**
 * Mirrors Core course catalog into the local QM library. Core is the source of truth —
 * imports new taught courses (each anchor is created already linked via `coreCourseId`,
 * #1072 §4 step 6 — no code-matching backfill) and refreshes topics for existing links.
 * Anchors are matched by `coreCourseId` (globally unique), NOT by owner: an anchor
 * materialized by someone else (ADMIN catalog visit, concurrent request) is adopted
 * and provisioned, never re-created.
 * Idempotent — safe to call on every /auth/me and GET /api/course request.
 */
export async function importTaughtCoursesFromCore(userId, role, cookie) {
  if (!AUTO_IMPORT_ROLES.has(role)) {
    return { imported: 0, skipped: 0 };
  }

  let coreCourses;
  try {
    const data = await listCoursesFromCore(cookie ?? '');
    coreCourses = Array.isArray(data?.courses) ? data.courses : [];
  } catch (err) {
    logger.warn({ err, userId }, 'Auto-import skipped: could not list Core courses');
    return { imported: 0, skipped: 0, error: err.message };
  }

  if (coreCourses.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const teachingCourses = coreCourses.filter((c) => c?.id && isTeachingCoreCourse(c));
  const skippedNonTeaching = coreCourses.length - teachingCourses.length;

  const anchors = teachingCourses.length
    ? await Course.findAll({
        where: { coreCourseId: { [Op.in]: teachingCourses.map((c) => c.id) } },
      })
    : [];
  const anchorByCoreId = new Map(anchors.map((course) => [course.coreCourseId, course]));

  let imported = 0;
  let skipped = skippedNonTeaching;
  let synced = 0;

  for (const coreCourse of teachingCourses) {
    let anchor = anchorByCoreId.get(coreCourse.id);

    if (!anchor) {
      try {
        anchor = await Course.create({ userId, coreCourseId: coreCourse.id });
        imported++;
      } catch (err) {
        // Unique `core_course_id` race: a concurrent request (or an ADMIN list
        // visit) created the anchor between our read and this insert. Adopt it.
        anchor = await Course.findOne({ where: { coreCourseId: coreCourse.id } });
        if (!anchor) {
          logger.warn({ err, userId, coreCourseId: coreCourse.id }, 'Auto-import failed for Core course');
          skipped++;
          continue;
        }
      }
    }

    if (anchor.userId !== userId) {
      try {
        await maybeClaimAnchor(userId, anchor);
      } catch (err) {
        logger.warn({ err, userId, courseId: anchor.id }, 'Anchor claim failed during auto-import');
      }
    }

    try {
      await provisionCourse(userId, anchor, cookie);
      synced++;
    } catch (err) {
      logger.warn({ err, userId, courseId: anchor.id }, 'Provisioning failed during Core import');
    }
  }

  if (imported > 0) {
    logger.info({ userId, imported, skipped }, 'Auto-imported taught courses from Core');
  }

  // Topic refresh for owned linked anchors OUTSIDE the teaching set (e.g. one
  // added manually via POST /api/course under a non-teaching enrollment) —
  // these were covered by the old per-owner refresh loop and still should be.
  const teachingCoreIds = new Set(teachingCourses.map((c) => c.id));
  const otherOwned = await Course.findAll({
    where: { userId, coreCourseId: { [Op.ne]: null } },
  });
  for (const localCourse of otherOwned) {
    if (teachingCoreIds.has(localCourse.coreCourseId)) continue;
    try {
      await syncTopicsFromCoreForCourse(localCourse, cookie);
      synced++;
    } catch (err) {
      logger.warn({ err, userId, courseId: localCourse.id }, 'Topic sync failed during Core import');
    }
  }

  return { imported, skipped, synced };
}
