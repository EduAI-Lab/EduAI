/**
 * Oracle for tests/models/progress-denominators.pict (census docs/PICT_CENSUS.md § S8).
 *
 * Derived from the #1187 decision, not from any single function:
 *   - An activity is only ever counted (denominator) when its lesson AND its
 *     lesson's module are both published. This is the single predicate now
 *     shared by calculateCourseProgress, calculateModuleProgress, and
 *     calculateLessonProgress (apps/extensions/ai-tutor/server/src/services/progressCalculation.js)
 *     — previously these three used three different filters (course checked
 *     both, module checked only lesson.isPublished, lesson checked neither),
 *     so the same activity could be counted at one scope and excluded at
 *     another. That divergence was a defect, fixed in #1187.
 *   - Completion is sticky, per the #1187 product decision: an activity
 *     counts as completed once ANY submission for it has ever been correct,
 *     regardless of order or of what the latest submission says. A later
 *     incorrect re-attempt does not undo completion (previously it did —
 *     completion was latest-attempt-only, so progress could decrease).
 *
 * This file is intentionally app-agnostic — the verdict is a semantic fact
 * about "is this activity counted, and is it complete," not about any one
 * of the three functions. The world-builder
 * (apps/extensions/ai-tutor/server/tests/integration/progress-denominators.pict.test.js)
 * seeds one activity per row and calls all three functions against it,
 * asserting all three agree with this oracle and with each other.
 */

export type ProgressDenominatorsRow = {
  LessonPublished: "yes" | "no";
  ModulePublished: "yes" | "no";
  AttemptPattern:
    | "not_attempted"
    | "correct_only"
    | "incorrect_only"
    | "correct_then_incorrect"
    | "incorrect_then_correct";
};

export type Verdict = {
  /** Does this activity contribute to the denominator (total) at all? */
  counted: boolean;
  /** Does this activity contribute to the numerator (completed)? Implies counted. */
  completed: boolean;
};

const EVER_CORRECT: Record<ProgressDenominatorsRow["AttemptPattern"], boolean> = {
  not_attempted: false,
  correct_only: true,
  incorrect_only: false,
  correct_then_incorrect: true,
  incorrect_then_correct: true,
};

export function progressDenominatorsOracle(row: ProgressDenominatorsRow): Verdict {
  const counted = row.LessonPublished === "yes" && row.ModulePublished === "yes";
  const completed = counted && EVER_CORRECT[row.AttemptPattern];
  return { counted, completed };
}

/**
 * Adapter: the exact `{ completed, total, percentage }` shape every one of
 * the three progressCalculation.js functions returns, for a world with
 * exactly one candidate activity.
 */
export function expectedResult(row: ProgressDenominatorsRow): {
  completed: number;
  total: number;
  percentage: number;
} {
  const verdict = progressDenominatorsOracle(row);
  const total = verdict.counted ? 1 : 0;
  const completed = verdict.completed ? 1 : 0;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, percentage };
}
