import type { Role } from '~/lib/types';
import type { AtCourseAccess, AtUser } from './types';

export type EnrollmentRole = 'STUDENT' | 'TA' | 'INSTRUCTOR';

export function isPlatformAdmin(user: AtUser | null | undefined): boolean {
  return user?.role === 'ADMIN';
}

export function isUnitAdmin(user: AtUser | null | undefined): boolean {
  return user?.role === 'UNIT_ADMIN';
}

export function isInstructorRole(user: AtUser | null | undefined): boolean {
  return user?.role === 'INSTRUCTOR';
}

export function isTaPlatformRole(user: AtUser | null | undefined): boolean {
  return user?.role === 'TA';
}

export function isStudentRole(user: AtUser | null | undefined): boolean {
  return user?.role === 'STUDENT';
}

/** True when the user uses the instructor route shell (authoring or TA read-only). */
export function usesInstructorShell(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return (
    user.role === 'INSTRUCTOR' ||
    user.role === 'UNIT_ADMIN' ||
    user.role === 'TA'
  );
}

export function resolvePlatformCourseAccess(user: AtUser | null | undefined): AtCourseAccess {
  if (!user?.role) return null;
  if (user.role === 'ADMIN') return 'admin';
  if (user.role === 'UNIT_ADMIN') return 'unit';
  if (user.role === 'INSTRUCTOR') return 'instructor';
  if (user.role === 'TA') return 'ta';
  if (user.role === 'STUDENT') return 'student';
  return null;
}

export function canManageContent(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === 'admin' || access === 'unit' || access === 'instructor';
}

export function canViewTeachingContent(user: AtUser | null | undefined): boolean {
  return usesInstructorShell(user);
}

/** Course lifecycle is owned by EduAI Core (#632); AI Tutor only imports/enables. */
export function canCreateCourse(_user: AtUser | null | undefined): boolean {
  return false;
}

export function canImportFromEduAi(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'ADMIN' || user.role === 'UNIT_ADMIN' || user.role === 'INSTRUCTOR';
}

/** EduAI catalog endpoint is INSTRUCTOR-only on the backend. */
export function canBrowseEduAiCatalog(user: AtUser | null | undefined): boolean {
  return user?.role === 'INSTRUCTOR';
}

export function canPublishContent(user: AtUser | null | undefined): boolean {
  return canManageContent(user);
}

export function canManageTopics(user: AtUser | null | undefined): boolean {
  return user?.role === 'INSTRUCTOR';
}

export function canManageEnrollments(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return (
    user.role === 'ADMIN' ||
    user.role === 'UNIT_ADMIN' ||
    user.role === 'INSTRUCTOR'
  );
}

export function canAssignTaRole(user: AtUser | null | undefined): boolean {
  return canManageEnrollments(user);
}

export function canViewCourseSubmissions(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === 'admin' || access === 'unit' || access === 'instructor' || access === 'ta';
}

export function canViewCourseAnalytics(user: AtUser | null | undefined): boolean {
  const access = resolvePlatformCourseAccess(user);
  return access === 'admin' || access === 'unit' || access === 'instructor';
}

export function canViewCourseStudentMetrics(user: AtUser | null | undefined): boolean {
  return canViewCourseAnalytics(user);
}

export function canAccessAdminConsole(user: AtUser | null | undefined): boolean {
  return user?.role === 'ADMIN';
}

export function canSyncEnrollmentsFromEduAi(user: AtUser | null | undefined): boolean {
  return user?.role === 'ADMIN';
}

export function canSubmitBugReport(user: AtUser | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'STUDENT' || user.role === 'INSTRUCTOR';
}

export function getRoleViewLabel(role: Role | string | undefined): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'UNIT_ADMIN':
      return 'Unit administrator';
    case 'INSTRUCTOR':
      return 'Instructor';
    case 'TA':
      return 'Teaching assistant';
    case 'STUDENT':
      return 'Student';
    default:
      return 'User';
  }
}
