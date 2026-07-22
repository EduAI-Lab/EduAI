/**
 * Campus-model size ranking for QM pickers/probes (frontend re-exports this module).
 */

/** @type {ReadonlyArray<readonly [RegExp, number]>} */
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
    if (pattern.test(lower)) return rank;
  }
  return 0;
}
