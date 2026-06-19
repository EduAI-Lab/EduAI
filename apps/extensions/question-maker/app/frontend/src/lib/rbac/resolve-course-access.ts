import type { QmCourseAccess, QmUser } from './types';

/**
 * Client-side course access for UI gating.
 * Without per-course enrollment on the client, platform role drives default access.
 * Backend middleware is authoritative for API calls.
 */
export function resolvePlatformCourseAccess(user: QmUser | null | undefined): QmCourseAccess {
  if (!user?.role) return null;
  switch (user.role) {
    case 'ADMIN':
      return 'admin';
    case 'UNIT_ADMIN':
      return 'unit';
    case 'INSTRUCTOR':
      return 'instructor';
    default:
      return null;
  }
}

export function isAuthoringAccess(access: QmCourseAccess): boolean {
  return access === 'admin' || access === 'unit' || access === 'instructor';
}
