import type { AppTourDefinition } from './tour-types';

export function markTourCompleted(tour: AppTourDefinition) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(tour.completionKey, 'true');
}

export function isLessonRoute(pathname: string) {
  return /^\/student\/lesson\/\d+$/.test(pathname);
}
