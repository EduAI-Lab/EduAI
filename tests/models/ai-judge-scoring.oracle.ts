/**
 * Oracle for tests/models/ai-judge-scoring.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Direct transcription of the documented scoring pipeline in
 * `reviewVariantExamWithAi` (apps/extensions/question-maker/app/backend/src/services/assessmentVariantService.js:1117-1226),
 * a fixed, commented product formula (composite weights, distinctness
 * factors, usability multiplier), not a read-off of incidental structure —
 * this model exists to lock that formula in as a regression contract, for a
 * single rubric-scored slot:
 *   - The five rubric dimensions combine into one 1-5 composite via a
 *     weighted average: conceptual_equivalence 0.24, the other four 0.19
 *     each.
 *   - `normalizeUsability` maps anything other than the two literal known
 *     strings to "unusable" — the harshest arm — including "unknown".
 *   - The usability multiplier (1.0 / 0.9 / 0.75) is applied
 *     UNCONDITIONALLY to the per-question `_usability_adjusted` score, but
 *     only applied to the exam-level final score when
 *     `applyUsabilityPenalty` is true. Same multiplier, two different gates.
 *   - Distinctness (a penalty dimension, not a rubric dimension) always
 *     applies to the exam-level final score via its own factor table,
 *     independent of `applyUsabilityPenalty`.
 */

export type Level = "low" | "high";
export type DistinctnessLevel = "low" | "mid" | "high";
export type Usability = "usable_as_is" | "usable_with_edits" | "unusable" | "unknown";

export type AiJudgeScoringRow = {
  ConceptualEquivalence: Level;
  DifficultySimilarity: Level;
  StructuralValidity: Level;
  AnswerCorrectness: Level;
  TopicAlignment: Level;
  Distinctness: DistinctnessLevel;
  Usability: Usability;
  ApplyUsabilityPenalty: "true" | "false";
};

const LEVEL_SCORE: Record<Level, number> = { low: 1, high: 5 };
const DISTINCTNESS_SCORE: Record<DistinctnessLevel, 1 | 3 | 5> = { low: 1, mid: 3, high: 5 };
const DISTINCTNESS_FACTOR: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0.1, 2: 0.4, 3: 0.7, 4: 0.9, 5: 1.0 };
const USABILITY_MULTIPLIER: Record<"usable_as_is" | "usable_with_edits" | "unusable", number> = {
  usable_as_is: 1.0,
  usable_with_edits: 0.9,
  unusable: 0.75,
};
const COMPOSITE_WEIGHTS = {
  conceptual_equivalence: 0.24,
  difficulty_similarity: 0.19,
  structural_validity: 0.19,
  answer_correctness: 0.19,
  topic_alignment: 0.19,
};

/** `normalizeUsability`: anything but the two literal known strings -> "unusable". */
export function normalizedUsability(usability: Usability): "usable_as_is" | "usable_with_edits" | "unusable" {
  if (usability === "usable_as_is" || usability === "usable_with_edits") return usability;
  return "unusable";
}

function normalize1to5To0to100(score1to5: number): number {
  return ((score1to5 - 1) / 4) * 100;
}

export type Verdict = {
  composite1to5: number;
  perQuestionUsabilityAdjusted1to5: number;
  examVariantScoreFinal0to100: number;
};

export function aiJudgeScoringOracle(row: AiJudgeScoringRow): Verdict {
  const values = {
    conceptual_equivalence: LEVEL_SCORE[row.ConceptualEquivalence],
    difficulty_similarity: LEVEL_SCORE[row.DifficultySimilarity],
    structural_validity: LEVEL_SCORE[row.StructuralValidity],
    answer_correctness: LEVEL_SCORE[row.AnswerCorrectness],
    topic_alignment: LEVEL_SCORE[row.TopicAlignment],
  };

  // Mirrors computeComposite1to5ForQuestion's accumulation exactly (same
  // iteration order, weightedSum / usedWeight division) so float rounding
  // matches the real implementation bit-for-bit rather than assuming the
  // five weights sum to exactly 1.0.
  let weightedSum = 0;
  let usedWeight = 0;
  for (const key of Object.keys(values) as (keyof typeof values)[]) {
    weightedSum += values[key] * COMPOSITE_WEIGHTS[key];
    usedWeight += COMPOSITE_WEIGHTS[key];
  }
  const composite1to5 = weightedSum / usedWeight;

  const usability = normalizedUsability(row.Usability);
  const usabilityMultiplier = USABILITY_MULTIPLIER[usability];
  const perQuestionUsabilityAdjusted1to5 = Math.max(1, Math.min(5, composite1to5 * usabilityMultiplier));

  const distinctnessScore = DISTINCTNESS_SCORE[row.Distinctness];
  const distinctnessFactor = DISTINCTNESS_FACTOR[distinctnessScore];
  const base0to100 = normalize1to5To0to100(composite1to5);
  const applyUsabilityPenalty = row.ApplyUsabilityPenalty === "true";
  const examVariantScoreFinal0to100 = Math.max(
    0,
    Math.min(100, base0to100 * distinctnessFactor * (applyUsabilityPenalty ? usabilityMultiplier : 1.0)),
  );

  return { composite1to5, perQuestionUsabilityAdjusted1to5, examVariantScoreFinal0to100 };
}
