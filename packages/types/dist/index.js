// Runtime constants for JavaScript consumers (e.g. QM backend)
export const USER_ROLE_VALUES = [
    'ADMIN',
    'UNIT_ADMIN',
    'INSTRUCTOR',
    'TA',
    'STUDENT',
];
export const ENROLLMENT_ROLE_VALUES = [
    'INSTRUCTOR',
    'TA',
    'STUDENT',
];
/**
 * Prefer an explicit has* flag from the list API; otherwise treat a non-empty
 * string body as present. Shared so AI Tutor / QM enablement stays in lockstep.
 */
export function hasAttachmentContent(value, flag) {
    return Boolean(flag ?? (value != null && value !== ''));
}
