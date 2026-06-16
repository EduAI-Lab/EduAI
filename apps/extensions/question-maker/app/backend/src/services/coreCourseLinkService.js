import { findScopedCoreCourseByCode } from './coreApiService.js';
import { logger } from '../utils/logger.js';

/** Links a local course to Core when code matches an enrolled Core course (#578). */
export async function ensureCoreCourseLink(course, cookie) {
  if (course.coreCourseId) return false;

  try {
    const match = await findScopedCoreCourseByCode(course.code, cookie);
    if (match?.id) {
      await course.update({ coreCourseId: match.id });
      logger.info(
        { courseId: course.id, coreCourseId: match.id, code: course.code },
        'Auto-linked local course to Core by code',
      );
      return true;
    }
  } catch (err) {
    logger.warn({ err, courseId: course.id }, 'Core course auto-link skipped');
  }

  return false;
}
