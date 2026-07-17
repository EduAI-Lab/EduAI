/**
 * Core Course CUID when the offering is linked; omit when unlinked (#1021).
 * Used by activities AI routes to forward `course.coreOfferingId` as EduAI `courseId`.
 */
export function getCoreCourseId(course) {
  const id = course?.coreOfferingId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
