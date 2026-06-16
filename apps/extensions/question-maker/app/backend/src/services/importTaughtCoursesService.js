/**
 * Auto-imports Core courses the instructor teaches into the local QM library on login.
 * Uses Core GET /api/courses (session-scoped via buildCourseListFilter).
 */
import { Course, Topics } from '../schema/index.js';
import { listCoursesFromCore } from './coreApiService.js';
import { normalizeCourseCode } from './courseCodeUtils.js';
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
    await createAssessment(userId, {
      type: 'Quiz',
      name: 'Practice Exam',
      semester: 'Fall 2026',
      description: '',
      courseId,
      blueprintConfig: null,
    });
  } catch (err) {
    logger.warn({ err, courseId }, 'Practice Exam creation skipped during auto-import');
  }
}

async function linkExistingCourseByCode(localCourse, coreCourseId, cookie) {
  await localCourse.update({ coreCourseId });
  await syncTopicsFromCoreForCourse(localCourse, cookie);

  const topics = await Topics.findAll({ where: { courseId: localCourse.id } });
  if (topics.length === 0) {
    await Topics.create({ name: 'General', courseId: localCourse.id });
  }
}

async function createLinkedCourse(userId, coreCourse, cookie) {
  const created = await Course.create({
    userId,
    name: coreCourse.name?.trim() || coreCourse.code?.trim() || 'Imported Course',
    code: coreCourse.code?.trim() || null,
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
 * Imports any Core courses the instructor teaches that are not yet linked locally.
 * Idempotent — safe to call on every /auth/me request.
 */
export async function importTaughtCoursesFromCore(userId, role, cookie) {
  if (!AUTO_IMPORT_ROLES.has(role)) {
    return { imported: 0, linked: 0, skipped: 0 };
  }

  let coreCourses;
  try {
    const data = await listCoursesFromCore(cookie ?? '');
    coreCourses = Array.isArray(data?.courses) ? data.courses : [];
  } catch (err) {
    logger.warn({ err, userId }, 'Auto-import skipped: could not list Core courses');
    return { imported: 0, linked: 0, skipped: 0, error: err.message };
  }

  if (coreCourses.length === 0) {
    return { imported: 0, linked: 0, skipped: 0 };
  }

  const localCourses = await Course.findAll({ where: { userId } });
  const linkedCoreIds = new Set(localCourses.map((course) => course.coreCourseId).filter(Boolean));
  const localByCode = new Map(
    localCourses
      .map((course) => [normalizeCourseCode(course.code), course])
      .filter(([code]) => code !== ''),
  );

  let imported = 0;
  let linked = 0;
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

    const normalizedCode = normalizeCourseCode(coreCourse.code);
    const existingLocal = normalizedCode ? localByCode.get(normalizedCode) : undefined;

    try {
      if (existingLocal && !existingLocal.coreCourseId) {
        await linkExistingCourseByCode(existingLocal, coreCourse.id, cookie);
        linkedCoreIds.add(coreCourse.id);
        linked++;
        continue;
      }

      if (existingLocal?.coreCourseId) {
        skipped++;
        continue;
      }

      const created = await createLinkedCourse(userId, coreCourse, cookie);
      linkedCoreIds.add(coreCourse.id);
      if (normalizedCode) {
        localByCode.set(normalizedCode, created);
      }
      imported++;
    } catch (err) {
      logger.warn({ err, userId, coreCourseId: coreCourse.id }, 'Auto-import failed for Core course');
      skipped++;
    }
  }

  if (imported > 0 || linked > 0) {
    logger.info({ userId, imported, linked, skipped }, 'Auto-imported taught courses from Core');
  }

  return { imported, linked, skipped };
}
