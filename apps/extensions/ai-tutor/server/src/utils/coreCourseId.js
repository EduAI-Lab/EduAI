/**
 * Trim a string to a non-empty value, or null.
 * Shared by activities wiring + callEduAI so trim/omit stay in sync (#1021).
 */
export function trimNonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Core Course CUID when the offering is linked; omit when unlinked (#1021).
 * Used by activities AI routes to forward `course.coreOfferingId` as EduAI `courseId`.
 */
export function getCoreCourseId(course) {
  return trimNonEmpty(course?.coreOfferingId);
}
