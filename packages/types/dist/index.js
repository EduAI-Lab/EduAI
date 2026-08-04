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
// Campus-model size ranking for QM pickers/probes. Shared here so the QM
// frontend doesn't need to reach into the QM backend's src/ to reuse it.
export const MODEL_SIZE_RANK_PATTERNS = Object.freeze([
    [/\b70b\b/, 70],
    [/\b32b\b/, 32],
    [/\b14b\b/, 14],
    [/\b7b\b/, 7],
    [/\b3b\b/, 3],
]);
/** Rank a model id/label string by parameter-size token (higher = larger). */
export function modelSizeRankFromText(text) {
    const lower = String(text ?? '').toLowerCase();
    for (const [pattern, rank] of MODEL_SIZE_RANK_PATTERNS) {
        if (pattern.test(lower))
            return rank;
    }
    return 0;
}
