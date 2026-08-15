/**
 * Oracle for tests/models/generate-questions.pict (census docs/PICT_CENSUS.md § S9).
 *
 * Derived from the spec for `POST /api/eduai/generate-questions`
 * (apps/extensions/question-maker/app/backend/src/routes/eduai.js:97), not
 * from the handler's branch order:
 *   - Only ADMIN/UNIT_ADMIN/INSTRUCTOR platform roles may reach this route
 *     at all (QM_AUTHORIZED, router-level flat gate) -> 403 otherwise.
 *   - `prompt` and `courseCode` are both required -> 400 if either is
 *     missing, checked before anything else request-shaped.
 *   - `numQuestions` (default 5) is rejected if it exceeds
 *     `config.maxQuestions` -> 400, checked BEFORE course access is
 *     resolved (a caller with no course access still gets the numQuestions
 *     400, not the access 403, when both would apply).
 *   - The caller must have at least TA-rank access to a QM course matching
 *     `courseCode` -> 403 COURSE_ACCESS_DENIED otherwise.
 *   - Below that, `mcqRequiredChoiceCount` is clamped into [2, 26] and
 *     forwarded only when provided as a finite number; omitted entirely
 *     otherwise. `difficultyDistribution`/`reasoningDistribution` are
 *     forwarded as provided, or a fixed default when absent.
 */

export type Authorized = "yes" | "no";
export type NumQuestions = "absent" | "valid" | "exceeds";
export type Mcq = "absent" | "valid" | "low" | "high";

export type GenerateQuestionsRow = {
  Authorized: Authorized;
  PromptPresent: "yes" | "no";
  CourseCodePresent: "yes" | "no";
  NumQuestions: NumQuestions;
  CourseAccess: "yes" | "no";
  Mcq: Mcq;
  DifficultyDistribution: "provided" | "absent";
  ReasoningDistribution: "provided" | "absent";
};

export const MAX_QUESTIONS = 50;
export const VALID_NUM_QUESTIONS = 10;
export const EXCEEDING_NUM_QUESTIONS = 51;
export const DEFAULT_NUM_QUESTIONS = 5;

export const MCQ_INPUT: Record<Mcq, number | undefined> = { absent: undefined, valid: 4, low: 1, high: 30 };
export const DEFAULT_DIFFICULTY_DISTRIBUTION = { easy: 1, medium: 2, hard: 2 };
export const PROVIDED_DIFFICULTY_DISTRIBUTION = { easy: 2, medium: 2, hard: 1 };
export const DEFAULT_REASONING_DISTRIBUTION = { factual: 40, analytical: 30, application: 30 };
export const PROVIDED_REASONING_DISTRIBUTION = { factual: 50, analytical: 25, application: 25 };

export type Verdict =
  | { status: 403; reason: "not-authorized" | "no-course-access" }
  | { status: 400 }
  | {
      status: 200;
      forwarded: {
        numQuestions: number;
        mcqRequiredChoiceCount: number | undefined;
        difficultyDistribution: Record<string, number>;
        reasoningDistribution: Record<string, number>;
      };
    };

function resolvedNumQuestions(row: GenerateQuestionsRow): number {
  if (row.NumQuestions === "absent") return DEFAULT_NUM_QUESTIONS;
  if (row.NumQuestions === "valid") return VALID_NUM_QUESTIONS;
  return EXCEEDING_NUM_QUESTIONS;
}

function expectedMcq(mcq: Mcq): number | undefined {
  const input = MCQ_INPUT[mcq];
  if (input === undefined) return undefined;
  return Math.min(26, Math.max(2, Math.floor(input)));
}

export function generateQuestionsOracle(row: GenerateQuestionsRow): Verdict {
  if (row.Authorized === "no") return { status: 403, reason: "not-authorized" };
  if (row.PromptPresent === "no" || row.CourseCodePresent === "no") return { status: 400 };
  if (resolvedNumQuestions(row) > MAX_QUESTIONS) return { status: 400 };
  if (row.CourseAccess === "no") return { status: 403, reason: "no-course-access" };

  return {
    status: 200,
    forwarded: {
      numQuestions: resolvedNumQuestions(row),
      mcqRequiredChoiceCount: expectedMcq(row.Mcq),
      difficultyDistribution:
        row.DifficultyDistribution === "provided" ? PROVIDED_DIFFICULTY_DISTRIBUTION : DEFAULT_DIFFICULTY_DISTRIBUTION,
      reasoningDistribution:
        row.ReasoningDistribution === "provided" ? PROVIDED_REASONING_DISTRIBUTION : DEFAULT_REASONING_DISTRIBUTION,
    },
  };
}
