/**
 * Oracle for tests/models/metadata-similarity-assembly.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Derived from the spec for `findBestBankMetadataForSlot` +
 * `scoreMetadataMatch` (apps/extensions/question-maker/app/backend/src/services/assessmentVariantService.js:404
 * and assessmentVariantMetadataScoring.js), not from the loop's incidental
 * `>` comparison:
 *   - A candidate's score is topic(+100) + type(+50) + difficulty(+25) +
 *     reasoning(+10), independently. The asymmetry is deliberate: topic
 *     match alone (100) clears the 75 cutoff; type+difficulty+reasoning
 *     together WITHOUT topic (85) also clears it; type alone (50), or
 *     difficulty+reasoning together (35), do not.
 *   - A candidate already used by an earlier slot in the same exam
 *     (`usedBankMetadataIds`) is skipped entirely, even if it would
 *     otherwise be the best (or only) match.
 *   - When the best candidate is skipped as already-used, a second
 *     ("fallback") bank candidate can still rescue the slot if one exists
 *     and it independently clears the cutoff.
 */

export type MetadataSimilarityAssemblyRow = {
  TopicMatch: "yes" | "no";
  TypeMatch: "yes" | "no";
  DifficultyMatch: "yes" | "no";
  ReasoningMatch: "yes" | "no";
  AlreadyUsed: "yes" | "no";
  HasFallback: "yes" | "no";
};

export function primaryScore(row: MetadataSimilarityAssemblyRow): number {
  let score = 0;
  if (row.TopicMatch === "yes") score += 100;
  if (row.TypeMatch === "yes") score += 50;
  if (row.DifficultyMatch === "yes") score += 25;
  if (row.ReasoningMatch === "yes") score += 10;
  return score;
}

export const MIN_METADATA_SCORE = 75;
/** The fallback candidate, when seeded, always matches on every dimension. */
export const FALLBACK_SCORE = 185;

export type Verdict = { found: false } | { found: true; winner: "primary" | "fallback"; score: number };

export function metadataSimilarityAssemblyOracle(row: MetadataSimilarityAssemblyRow): Verdict {
  if (row.AlreadyUsed === "yes") {
    if (row.HasFallback === "no") return { found: false };
    return { found: true, winner: "fallback", score: FALLBACK_SCORE };
  }
  const score = primaryScore(row);
  if (score < MIN_METADATA_SCORE) return { found: false };
  return { found: true, winner: "primary", score };
}
