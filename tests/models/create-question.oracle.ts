/**
 * Oracle for tests/models/create-question.pict (census docs/PICT_CENSUS.md § S7, #1186).
 *
 * Derived from the documented precedence in `createQuestion` (lib/questions/server.ts:45),
 * not from copying its branches: schema validation runs first (a malformed
 * payload never touches the DB); then course existence; then the primary
 * topic's existence and non-deleted state; then the exact-duplicate check
 * (the primary id reappearing in the secondary list); then the secondary
 * topics' existence and non-deleted state, with missing and soft-deleted ids
 * folded into ONE error rather than reported separately; otherwise the
 * question (plus any secondary-topic links) is created.
 */

export type CreateQuestionRow = {
  Validity: "valid" | "invalid";
  Course: "exists" | "missing";
  PrimaryTopic: "exists" | "missing" | "deleted";
  SecondaryTopicIds:
    | "none"
    | "valid"
    | "duplicate-primary"
    | "all-missing"
    | "all-deleted"
    | "mixed-missing-and-deleted";
  Type: "MCQ" | "SA" | "LA";
};

export type Verdict =
  | { outcome: "VALIDATION_ERROR" }
  | { outcome: "COURSE_NOT_FOUND" }
  | { outcome: "TOPIC_NOT_FOUND" }
  | { outcome: "DUPLICATE_TOPIC" }
  | { outcome: "INVALID_TOPIC_IDS" }
  | { outcome: "SUCCESS" };

export function createQuestionOracle(row: CreateQuestionRow): Verdict {
  if (row.Validity === "invalid") return { outcome: "VALIDATION_ERROR" };
  if (row.Course === "missing") return { outcome: "COURSE_NOT_FOUND" };
  if (row.PrimaryTopic !== "exists") return { outcome: "TOPIC_NOT_FOUND" };
  if (row.SecondaryTopicIds === "duplicate-primary") return { outcome: "DUPLICATE_TOPIC" };
  if (
    row.SecondaryTopicIds === "all-missing" ||
    row.SecondaryTopicIds === "all-deleted" ||
    row.SecondaryTopicIds === "mixed-missing-and-deleted"
  ) {
    return { outcome: "INVALID_TOPIC_IDS" };
  }
  return { outcome: "SUCCESS" };
}
