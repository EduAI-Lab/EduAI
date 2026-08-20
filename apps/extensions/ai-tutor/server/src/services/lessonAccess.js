/**
 * @file Shared lesson membership / visibility for GET /lessons/:id family.
 *
 * The lesson body, breadcrumb, and tree-context routes all need the same
 * membership checks. Keep that in one place so a student-vs-elevated change
 * cannot drift across endpoints (#1334 review).
 */
import { isUnitAdminForCourse } from '../middleware/auth.js';

/**
 * Resolve whether `authUser` may see `lesson` and how sibling visibility
 * should be scoped.
 *
 * @param {{ id: string, role: string, authorizedUnits?: string[] }} authUser
 * @param {{ isPublished: boolean, module: { courseOffering: object } }} lesson
 *   Lesson with `module.courseOffering` including `instructors` and `enrollments`.
 * @returns {Promise<{
 *   isMember: boolean,
 *   hasElevatedAccess: boolean,
 *   publishedOnly: boolean,
 *   isStudent: boolean,
 * }>}
 */
export async function resolveLessonAccess(authUser, lesson) {
  const { courseOffering } = lesson.module;
  const isInstructor = courseOffering.instructors.some((i) => i.userId === authUser.id);
  const enrollment = courseOffering.enrollments.find((e) => e.userId === authUser.id);
  const isTa = enrollment?.role === 'TA';
  const isStudent = enrollment?.role === 'STUDENT';
  const unitAdmin = await isUnitAdminForCourse(authUser, courseOffering);
  const isAdmin = authUser.role === 'ADMIN';
  const hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin;
  const isMember = hasElevatedAccess || isStudent;
  const publishedOnly = isStudent && !hasElevatedAccess;

  return { isMember, hasElevatedAccess, publishedOnly, isStudent };
}
