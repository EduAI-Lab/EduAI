/**
 * Auto-imports Core courses the instructor teaches into the local QM library on login.
 * Uses Core GET /api/courses (session-scoped via buildCourseListFilter).
 */
import { Op } from 'sequelize';
import { Course, Topics } from '../schema/index.js';
import { listCoursesFromCore } from './coreApiService.js';
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

async function createLinkedCourse(userId, coreCourse, cookie) {
  // `name`/`code` are Core-owned and read through Core at every read seam
  // (#1072 §4 step 10) — the anchor row only needs the link, not a local copy.
  const created = await Course.create({
    userId,
    coreCourseId: coreCourse.id,
  });

  await syncTopicsFromCoreForCourse(created, cookie);

  const topics = await Topics.findAll({ where: { courseId: created.id } });
  if (topics.length === 0) {
    await Topics.create({ name: 'General', courseId: created.id });
  }

  await ensurePracticeExam(userId, created.id);
  return created;
}

/**
 * Mirrors Core course catalog into the local QM library. Core is the source of truth —
 * imports new taught courses (each anchor is created already linked via `coreCourseId`,
 * #1072 §4 step 6 — no code-matching backfill) and refreshes topics for existing links.
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

  const localCourses = await Course.findAll({ where: { userId } });
  const linkedCoreIds = new Set(localCourses.map((course) => course.coreCourseId).filter(Boolean));

  let imported = 0;
  let skipped = 0;

  for (const coreCourse of coreCourses) {
    if (!coreCourse?.id) {
      skipped++;
      continue;
    }

    if (!isTeachingCoreCourse(coreCourse)) {
      skipped++;
      continue;
    }

    if (linkedCoreIds.has(coreCourse.id)) {
      skipped++;
      continue;
    }

    try {
      await createLinkedCourse(userId, coreCourse, cookie);
      linkedCoreIds.add(coreCourse.id);
      imported++;
    } catch (err) {
      logger.warn({ err, userId, coreCourseId: coreCourse.id }, 'Auto-import failed for Core course');
      skipped++;
    }
  }

  if (imported > 0) {
    logger.info({ userId, imported, skipped }, 'Auto-imported taught courses from Core');
  }

  let synced = 0;
  const linkedCourses = await Course.findAll({
    where: { userId, coreCourseId: { [Op.ne]: null } },
  });

  for (const localCourse of linkedCourses) {
    try {
      await syncTopicsFromCoreForCourse(localCourse, cookie);
      synced++;
    } catch (err) {
      logger.warn({ err, userId, courseId: localCourse.id }, 'Topic sync failed during Core import');
    }
  }

  return { imported, skipped, synced };
}
