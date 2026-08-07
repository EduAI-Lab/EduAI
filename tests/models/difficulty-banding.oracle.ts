/**
 * Oracle for tests/models/difficulty-banding.pict (census docs/PICT_CENSUS.md § S8).
 *
 * `calculateDifficulty` is a documented, hand-tuned policy heuristic — its
 * own doc comment (apps/extensions/ai-tutor/server/src/services/activityAnalytics.js:34)
 * states the coefficients (15/45/25) and the 35/65 label thresholds as
 * deliberate product decisions, in that stated priority order: incorrect
 * answers weigh most, then AI-help demand, then student sentiment. That doc
 * comment is this oracle's spec — the formula below is a direct transcription
 * of it, not a read-off of incidental handler structure, and this model
 * exists to lock the documented formula in as a regression contract.
 *
 * `AverageRating` deliberately includes both "null" (no feedback yet) and
 * "perfect" (rating of 5): `ratingPenalty = (5 - averageRating) / 4` is 0 for
 * a perfect rating, and the null branch also yields 0 — the two are
 * indistinguishable in the score today. This oracle asserts that
 * equivalence explicitly, as a documented simplification of the heuristic,
 * not an accident to paper over.
 */

export type DifficultyBandingRow = {
  StudentCount: "zero" | "one" | "many";
  HelpRequestCount: "zero" | "low" | "high";
  SubmissionCount: "zero" | "nonzero";
  IncorrectRate: "zero" | "half" | "all";
  AverageRating: "null" | "worst" | "mid" | "perfect";
};

export type DifficultyInputs = {
  studentCount: number;
  helpRequestCount: number;
  submissionCount: number;
  incorrectSubmissionCount: number;
  averageRating: number | null;
};

const STUDENT_COUNT: Record<DifficultyBandingRow["StudentCount"], number> = { zero: 0, one: 1, many: 10 };
const HELP_REQUEST_COUNT: Record<DifficultyBandingRow["HelpRequestCount"], number> = { zero: 0, low: 1, high: 20 };
const SUBMISSION_COUNT: Record<DifficultyBandingRow["SubmissionCount"], number> = { zero: 0, nonzero: 10 };
const INCORRECT_RATE: Record<DifficultyBandingRow["IncorrectRate"], number> = { zero: 0, half: 0.5, all: 1 };
const AVERAGE_RATING: Record<DifficultyBandingRow["AverageRating"], number | null> = {
  null: null,
  worst: 1,
  mid: 3,
  perfect: 5,
};

/** Concrete inputs to pass to the real `calculateDifficulty`. */
export function buildInputs(row: DifficultyBandingRow): DifficultyInputs {
  const submissionCount = SUBMISSION_COUNT[row.SubmissionCount];
  const incorrectSubmissionCount = Math.round(submissionCount * INCORRECT_RATE[row.IncorrectRate]);
  return {
    studentCount: STUDENT_COUNT[row.StudentCount],
    helpRequestCount: HELP_REQUEST_COUNT[row.HelpRequestCount],
    submissionCount,
    incorrectSubmissionCount,
    averageRating: AVERAGE_RATING[row.AverageRating],
  };
}

export type DifficultyVerdict = { difficultyScore: number; difficultyLabel: "LOW" | "MEDIUM" | "HIGH" };

/** Direct transcription of the documented formula — see file docstring. */
export function difficultyBandingOracle(row: DifficultyBandingRow): DifficultyVerdict {
  const { studentCount, helpRequestCount, submissionCount, incorrectSubmissionCount, averageRating } =
    buildInputs(row);

  const normalizedStudentCount = Math.max(studentCount || 0, 1);
  const helpPerStudent = helpRequestCount / normalizedStudentCount;
  const incorrectRate = submissionCount > 0 ? incorrectSubmissionCount / submissionCount : 0;
  const ratingPenalty = typeof averageRating === "number" ? (5 - averageRating) / 4 : 0;

  const difficultyScore = Math.max(
    0,
    Math.min(100, Math.round(helpPerStudent * 15 + incorrectRate * 45 + ratingPenalty * 25)),
  );
  const difficultyLabel = difficultyScore >= 65 ? "HIGH" : difficultyScore >= 35 ? "MEDIUM" : "LOW";

  return { difficultyScore, difficultyLabel };
}
