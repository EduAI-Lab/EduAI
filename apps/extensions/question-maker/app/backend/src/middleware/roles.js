/**
 * Canonical role constants for Question Maker RBAC.
 * Role names must stay in sync with Core's UserRole enum:
 *   apps/core/app/lib/rbac/types.ts → UserRole
 * TODO: #594
 */

export const VALID_ROLES = new Set(['STUDENT', 'INSTRUCTOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

// Flat arrays used as arguments to requireRole() in route files.
export const AUTHORS    = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA'];
export const INSTRUCTORS = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
export const CANVAS_ROLES = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];
