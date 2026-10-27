import { describe, it, expect } from "vitest";
import {
  evaluateQuestion,
  overrideFeedbackMessage,
  submissionResultMessage,
} from "../../src/services/activityEvaluation.js";

describe("evaluateQuestion", () => {
  // ── MCQ: answer stored as raw number ──────────────────────────────

  it("MCQ correct — config.answer is a raw number", () => {
    const activity = { config: { questionType: "MCQ", answer: 2 } };
    const payload = { answerOption: 2 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it("MCQ incorrect — config.answer is a raw number", () => {
    const activity = { config: { questionType: "MCQ", answer: 2 } };
    const payload = { answerOption: 0 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: false });
  });

  // ── MCQ: answer stored as object { correctIndex } ────────────────

  it("MCQ correct — config.answer is { correctIndex }", () => {
    const activity = { config: { questionType: "MCQ", answer: { correctIndex: 1 } } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  it("MCQ incorrect — config.answer is { correctIndex }", () => {
    const activity = { config: { questionType: "MCQ", answer: { correctIndex: 3 } } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: false });
  });

  // ── MCQ: defaults questionType to MCQ when not specified ──────────

  it("defaults questionType to MCQ when config omits it", () => {
    const activity = { config: { answer: 0 } };
    const payload = { answerOption: 0 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: true });
  });

  // ── SHORT_TEXT: never auto-graded (#2027) ─────────────────────────

  it.each([
    ["exact match", "Photosynthesis", "Photosynthesis"],
    ["case/whitespace match", "  hello  ", "  HELLO  "],
    ["different text", "Paris", "London"],
    ["paraphrase", "The base case stops recursion.", "Recursion ends at the base case."],
  ])("SHORT_TEXT with a reference answer stays ungraded — %s", (_label, answer, answerText) => {
    const activity = { config: { questionType: "SHORT_TEXT", answer } };
    expect(evaluateQuestion(activity, { answerText })).toEqual({ isCorrect: null });
  });

  it("SHORT_TEXT with { text } reference answer stays ungraded", () => {
    const activity = { config: { questionType: "SHORT_TEXT", answer: { text: "Oxygen" } } };
    const payload = { answerText: "oxygen" };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  // ── Null / missing data edge cases ────────────────────────────────

  it("returns isCorrect null when config has no answer", () => {
    const activity = { config: { questionType: "MCQ" } };
    const payload = { answerOption: 1 };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  it('SHORT_TEXT open-ended (no answer key) stays ungraded — isCorrect null, not ""', () => {
    // An open-ended short-text question can't be auto-graded; the submission is
    // left for a human. Must be null (the "to review" queue), never "" — the
    // `Submission.isCorrect Boolean?` column rejects an empty string.
    const activity = { config: { questionType: "SHORT_TEXT" } };
    const payload = { answerText: "a thoughtful open-ended answer" };
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  it("returns isCorrect null when payload has no answerOption for MCQ", () => {
    const activity = { config: { questionType: "MCQ", answer: 2 } };
    const payload = {};
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });

  it("returns isCorrect null when activity.config is missing entirely", () => {
    const activity = {};
    const payload = { answerOption: 0 };
    // config ?? {} means questionType defaults to MCQ, but no answer exists
    expect(evaluateQuestion(activity, payload)).toEqual({ isCorrect: null });
  });
});

describe("submissionResultMessage", () => {
  it("praises a correct answer and nudges a wrong one", () => {
    expect(submissionResultMessage(true)).toBe("Nice! That looks right.");
    expect(submissionResultMessage(false)).toBe("Not quite. Try another angle.");
  });

  it("never calls an ungraded (null) answer wrong (#1982)", () => {
    expect(submissionResultMessage(null)).toBe(
      "Submitted. Your instructor will review this answer.",
    );
  });
});

describe("overrideFeedbackMessage", () => {
  it("matches the staff verdict (#2033)", () => {
    expect(overrideFeedbackMessage(true)).toBe("Marked correct by your instructor.");
    expect(overrideFeedbackMessage(false)).toBe("Marked incorrect by your instructor.");
    expect(overrideFeedbackMessage(null)).toBe(
      "Submitted. Your instructor will review this answer.",
    );
  });
});
