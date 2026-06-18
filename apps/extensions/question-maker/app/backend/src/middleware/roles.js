import { USER_ROLE_VALUES } from '@eduai/types';

export const VALID_ROLES = new Set(USER_ROLE_VALUES);

// Used as arguments to requireRole() in route files.
export const AUTHORS    = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA'];
export const INSTRUCTORS = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
export const CANVAS_ROLES = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
