/**
 * Unit tests for assessment builder shared types/constants (#1544).
 */
import { describe, expect, it } from "vitest";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  defaultReasoningData,
} from "@/pages/assessments/assessmentViewTypes";

describe("assessmentViewTypes", () => {
  it("exposes the three question types", () => {
    expect(QUESTION_TYPES).toEqual(["MCQ", "SA", "LA"]);
  });

  it("maps every question type to a human label", () => {
    expect(QUESTION_TYPE_LABELS).toEqual({
      MCQ: "Multiple Choice",
      SA: "Short Answer",
      LA: "Long Answer",
    });
  });

  it("builds default reasoning data with expected buckets", () => {
    const data = defaultReasoningData();
    expect(data.factual).toEqual({ total: 40, easyBoundary: 60, hardBoundary: 90 });
    expect(data.analytical).toEqual({ total: 35, easyBoundary: 50, hardBoundary: 80 });
    expect(data.application).toEqual({ total: 25, easyBoundary: 40, hardBoundary: 70 });
  });

  it("returns a fresh object on each call", () => {
    const a = defaultReasoningData();
    const b = defaultReasoningData();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
