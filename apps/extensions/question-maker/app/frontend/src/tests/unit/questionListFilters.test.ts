/**
 * #1762 — pure helpers shared by the question list surfaces: filter → service
 * options, variant-level narrowing inside server-matched questions, and bank → option.
 */
import { describe, expect, it } from "vitest";
import {
  toBankOptions,
  toQuestionListOptions,
  variantMatchesFilters,
} from "@/components/question-bank/questionListFilters";
import {
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
} from "@/components/question-bank/QuestionFilterToolbar";
import type { QuestionVariant, QuestionVariantEntry } from "@/types/question";

function entry(
  overrides: Partial<QuestionVariantEntry> = {},
  variant: Partial<QuestionVariant> = {},
) {
  return {
    questionId: 1,
    questionDescription: "Arithmetic",
    questionType: "MCQ",
    primaryTopicId: "1",
    courseId: 7,
    isAiGenerated: false,
    isDraft: false,
    variant: {
      id: 1,
      questionText: "What is 2 + 2?",
      difficulty: "easy",
      reasoningLevel: "factual",
      referenceId: null,
      ...variant,
    },
    ...overrides,
  } as unknown as QuestionVariantEntry;
}

describe("toQuestionListOptions", () => {
  it("maps filters, search and sort to service options", () => {
    const filters: QuestionFilters = {
      questionTypes: ["SA"],
      difficulties: ["hard"],
      reasoningLevels: ["analytical"],
      aiGenerated: "ai",
      draftStatus: "reviewed",
      questionBankId: "bank-2",
    };
    expect(toQuestionListOptions(filters, "gravity", "oldest")).toEqual({
      search: "gravity",
      types: ["SA"],
      difficulties: ["hard"],
      reasoningLevels: ["analytical"],
      aiGenerated: "ai",
      draftStatus: "reviewed",
      sortBy: "oldest",
      questionBankId: "bank-2",
    });
  });

  it("omits an empty search and a null bank", () => {
    const options = toQuestionListOptions(EMPTY_QUESTION_FILTERS, "", "newest");
    expect(options.search).toBeUndefined();
    expect(options.questionBankId).toBeUndefined();
  });
});

describe("variantMatchesFilters", () => {
  it("matches everything with no filters", () => {
    expect(variantMatchesFilters(entry(), "", EMPTY_QUESTION_FILTERS)).toBe(true);
  });

  it("keeps every variant when the search hits the question description", () => {
    expect(variantMatchesFilters(entry(), "arith", EMPTY_QUESTION_FILTERS)).toBe(true);
  });

  it("narrows by variant text when the description does not match", () => {
    expect(variantMatchesFilters(entry(), "2 + 2", EMPTY_QUESTION_FILTERS)).toBe(true);
    expect(variantMatchesFilters(entry(), "triangle", EMPTY_QUESTION_FILTERS)).toBe(false);
  });

  it("narrows by difficulty and reasoning level", () => {
    const hard = { ...EMPTY_QUESTION_FILTERS, difficulties: ["hard"] } as QuestionFilters;
    expect(variantMatchesFilters(entry(), "", hard)).toBe(false);
    expect(variantMatchesFilters(entry({}, { difficulty: "hard" }), "", hard)).toBe(true);

    const analytical = {
      ...EMPTY_QUESTION_FILTERS,
      reasoningLevels: ["analytical"],
    } as QuestionFilters;
    expect(variantMatchesFilters(entry(), "", analytical)).toBe(false);
    expect(variantMatchesFilters(entry({}, { reasoningLevel: undefined }), "", analytical)).toBe(
      false,
    );
  });

  it("narrows by AI source and draft status", () => {
    const ai = { ...EMPTY_QUESTION_FILTERS, aiGenerated: "ai" } as QuestionFilters;
    expect(variantMatchesFilters(entry({ isAiGenerated: true }), "", ai)).toBe(true);
    expect(variantMatchesFilters(entry({ isAiGenerated: false }), "", ai)).toBe(false);

    const drafts = { ...EMPTY_QUESTION_FILTERS, draftStatus: "draft" } as QuestionFilters;
    expect(variantMatchesFilters(entry({ isDraft: true }), "", drafts)).toBe(true);
    expect(variantMatchesFilters(entry({ isDraft: false }), "", drafts)).toBe(false);
  });

  it("leaves question type and bank to the server", () => {
    const filters = {
      ...EMPTY_QUESTION_FILTERS,
      questionTypes: ["SA"],
      questionBankId: "bank-2",
    } as QuestionFilters;
    expect(variantMatchesFilters(entry(), "", filters)).toBe(true);
  });
});

describe("toBankOptions", () => {
  it("maps banks to select options", () => {
    expect(
      toBankOptions([
        { id: "b1", courseId: 7, name: "Course bank", isDefault: true },
        { id: "b2", courseId: 7, name: "Midterm", isDefault: false },
      ]),
    ).toEqual([
      { value: "b1", label: "Course bank", isDefault: true },
      { value: "b2", label: "Midterm", isDefault: false },
    ]);
  });
});
