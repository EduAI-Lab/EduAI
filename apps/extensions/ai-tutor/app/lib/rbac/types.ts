import type { Role } from '~/lib/types';

/** Course-scoped access level — mirrors backend isCourseAdmin / enrollment checks. */
export type AtCourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | 'student' | null;

export type AtUser = {
  id: string;
  role: Role;
  authorizedUnits?: string[];
};

export type AtRoleView = 'admin' | 'unit-admin' | 'instructor' | 'ta' | 'student';

export type AtNavItemKey =
  | 'teaching'
  | 'my-courses'
  | 'admin-courses'
  | 'admin-bug-reports'
  | 'enrollments'
  | 'analytics';

export type AtNavItem = {
  key: AtNavItemKey;
  title: string;
  href: string;
};
