import type { Role } from '~/lib/types';
import type { AppTourDefinition, AppTourId } from './tour-types';

export function markTourCompleted(tour: AppTourDefinition) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(tour.completionKey, 'true');
}

export function isLessonRoute(pathname: string) {
  return /^\/student\/lesson\/\d+$/.test(pathname);
}

/** STUDENT/TA on student routes, plus TA on the instructor shell (TAs can also use student flows). */
export function canAccessStudentTour(role: Role | undefined, pathname: string) {
  if (pathname.startsWith('/student')) {
    return role === 'STUDENT' || role === 'TA';
  }
  if (role === 'TA' && pathname.startsWith('/instructor')) return true;
  return false;
}

export function resolveSuggestedTourId(
  role: Role | undefined,
  pathname: string,
): AppTourId | null {
  if (!canAccessStudentTour(role, pathname)) return null;
  if (!pathname.startsWith('/student')) return 'student-journey';
  return isLessonRoute(pathname) ? 'student-lesson-help' : 'student-journey';
}
