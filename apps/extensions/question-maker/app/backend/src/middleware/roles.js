import { USER_ROLE_VALUES } from '@eduai/types';

export const VALID_ROLES = new Set(USER_ROLE_VALUES);

// Used as arguments to requireRole() in route files.
// #225 AUTH-12: platform UserRole has no TA (a course TA is enrollment-scoped).
export const AUTHORS    = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
export const INSTRUCTORS = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
export const CANVAS_ROLES = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];

/** Platform roles allowed to use Question Maker authoring (excludes STUDENT and TA). */
export const QM_AUTHORIZED = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
