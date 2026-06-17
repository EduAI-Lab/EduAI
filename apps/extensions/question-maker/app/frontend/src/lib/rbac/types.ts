/** Platform roles that may enter Question Maker (app gate). */
export type QmPlatformRole = 'ADMIN' | 'UNIT_ADMIN' | 'INSTRUCTOR';

/** Course-scoped access level — mirrors backend courseAccess.js ranks. */
export type QmCourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | null;

export type QmUser = {
  id: string;
  role: string;
  authorizedUnits?: string[];
};

export type QmRoleView = 'admin' | 'unit-admin' | 'instructor';

export type QmNavItemKey =
  | 'courses'
  | 'questions'
  | 'assessments'
  | 'variants'
  | 'help'
  | 'bug-reports'
  | 'back-to-eduai';

export type QmNavItem = {
  key: QmNavItemKey;
  title: string;
  href: string;
  external?: boolean;
  match?: (pathname: string, search: string) => boolean;
};

/** Resource with optional ownership for TA own-only rules (§16). */
export type OwnableResource = {
  createdBy?: string | null;
};
