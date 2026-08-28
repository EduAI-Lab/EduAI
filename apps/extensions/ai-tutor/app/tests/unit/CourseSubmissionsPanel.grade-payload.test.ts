import { describe, expect, it } from "vitest";
import { buildGradePayload } from "~/components/courses/CourseSubmissionsPanel";

// The grade dialog used to OMIT the fields it had nothing to say about, so
// "Not graded" with a cleared score posted `{}` and the route answered
// `400 Nothing to update` — a grade could not be taken back at all.
describe("buildGradePayload", () => {
  it("nulls both fields when the grade is taken back", () => {
    expect(buildGradePayload("ungraded", "")).toEqual({ isCorrect: null, score: null });
  });

  it("nulls the score when it is cleared but the verdict stays", () => {
    expect(buildGradePayload("correct", "")).toEqual({ isCorrect: true, score: null });
  });

  it("sends the verdict and the score together", () => {
    expect(buildGradePayload("incorrect", "3.5")).toEqual({ isCorrect: false, score: 3.5 });
  });

  it("tolerates whitespace around the score", () => {
    expect(buildGradePayload("correct", "  7 ")).toEqual({ isCorrect: true, score: 7 });
  });

  it("accepts a zero score rather than reading it as blank", () => {
    expect(buildGradePayload("incorrect", "0")).toEqual({ isCorrect: false, score: 0 });
  });

  it("refuses a non-numeric score instead of silently clearing it", () => {
    expect(buildGradePayload("correct", "abc")).toBeNull();
  });
});
