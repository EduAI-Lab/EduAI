/**
 * Campus-model size ranking for QM frontend pickers/probes.
 * Keep in sync with backend `src/utils/modelSizeRanks.js` when adding sizes.
 */

export const MODEL_SIZE_RANK_PATTERNS: ReadonlyArray<readonly [RegExp, number]> = Object.freeze([
  [/\b70b\b/, 70],
  [/\b32b\b/, 32],
  [/\b14b\b/, 14],
  [/\b7b\b/, 7],
  [/\b3b\b/, 3],
]);

/** Rank a model id/label string by parameter-size token (higher = larger). */
export function modelSizeRankFromText(text: string | null | undefined): number {
  const lower = String(text ?? '').toLowerCase();
  for (const [pattern, rank] of MODEL_SIZE_RANK_PATTERNS) {
    if (pattern.test(lower)) return rank;
  }
  return 0;
}
