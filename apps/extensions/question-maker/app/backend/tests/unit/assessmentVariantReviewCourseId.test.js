/**
 * reviewVariantExamWithAi — Course.code was removed by #1072; regression that
 * review loads only id/coreCourseId and resolves live code via enrichCourseDetail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();
const findOne = vi.fn();
const enrichCourseDetail = vi.fn();
const loadOrderedVariantsForAssessment = vi.fn();

vi.mock("../../src/services/eduaiService.js", () => ({
  default: {
    isConfigured: () => true,
    chat,
  },
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    assessments: { findFirst: findOne },
    assessmentSections: {},
    sectionVariants: {},
    variants: {},
    questionMetadata: {},
    course: {},
    topics: {},
    variantSelectionCursor: {},
  },
}));

vi.mock("../../src/services/courseListService.js", () => ({
  enrichCourseDetail,
  formatSemesterDisplay: vi.fn(),
  deriveSemesterDisplayForCourseId: vi.fn(),
}));

vi.mock("../../src/services/assessmentVariantUtils.js", () => ({
  loadOrderedVariantsForAssessment,
  aggregateStructure: vi.fn(),
}));

vi.mock("../../src/services/assessmentVariantMetadataScoring.js", () => ({
  scoreMetadataMatch: vi.fn(),
}));

const { reviewVariantExamWithAi } = await import("../../src/services/assessmentVariantService.js");

describe("reviewVariantExamWithAi (#1072 course code read-through)", () => {
  beforeEach(() => {
    chat.mockReset();
    findOne.mockReset();
    enrichCourseDetail.mockReset();
    loadOrderedVariantsForAssessment.mockReset();

    const course = { id: 3, coreCourseId: "cuid-core-course" };
    findOne.mockResolvedValue({
      id: 10,
      courseId: 3,
      course,
    });
    enrichCourseDetail.mockResolvedValue({
      id: 3,
      coreCourseId: "cuid-core-course",
      code: "COSC 121",
      name: "Computer Programming I",
    });
    loadOrderedVariantsForAssessment.mockResolvedValue([
      {
        id: 1,
        questionText: "What is recursion?",
        answer: "A function calling itself",
        choices: [],
      },
    ]);
    chat.mockResolvedValue({
      content: JSON.stringify({
        conceptual_equivalence: 5,
        difficulty_similarity: 5,
        structural_validity: 5,
        answer_correctness: 5,
        topic_alignment: 5,
        distinctness: 4,
        usability: "usable_as_is",
        brief_reason: "Good variant",
      }),
    });
  });

  it("does not select Course.code and forwards enriched code + coreCourseId", async () => {
    await reviewVariantExamWithAi(42, {
      baselineAssessmentId: 10,
      variantAssessmentId: 11,
      courseId: 3,
      model: "vllm:qwen2.5-32b-instruct",
      apiKeys: { vllm: { isEnabled: true } },
      cookie: "session=abc",
    });

    expect(findOne).toHaveBeenCalledTimes(2);
    for (const call of findOne.mock.calls) {
      const select = call[0]?.include?.course?.select;
      expect(select).toEqual({ id: true, coreCourseId: true });
      expect(select).not.toHaveProperty("code");
    }

    expect(enrichCourseDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, coreCourseId: "cuid-core-course" }),
      { cookie: "session=abc" },
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0][0];
    expect(chatArgs.courseId).toBe("cuid-core-course");
    expect(chatArgs.courseCode).toBe("COSC 121");
    expect(chatArgs.cookie).toBe("session=abc");
  });

  it("rejects an oversized pair set before any provider call or Core metadata probe", async () => {
    const slots = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      questionText: `Question ${index + 1}`,
      answer: "answer",
      choices: [],
    }));
    loadOrderedVariantsForAssessment.mockResolvedValue(slots);

    await expect(
      reviewVariantExamWithAi(42, {
        baselineAssessmentId: 10,
        variantAssessmentId: 11,
        courseId: 3,
        cookie: "session=abc",
      }),
    ).rejects.toMatchObject({ code: "QM_REVIEW_PAIR_COUNT_TOO_LARGE" });

    expect(chat).not.toHaveBeenCalled();
    expect(enrichCourseDetail).not.toHaveBeenCalled();
  });

  it("does not call a later pair after an upstream 429", async () => {
    const rateLimited = new Error("provider body should not escape");
    rateLimited.statusCode = 429;
    loadOrderedVariantsForAssessment.mockResolvedValue([
      { id: 1, questionText: "Original", answer: "a", choices: [] },
      { id: 2, questionText: "Second", answer: "b", choices: [] },
    ]);
    chat.mockRejectedValueOnce(rateLimited).mockResolvedValue({
      content: JSON.stringify({
        conceptual_equivalence: 5,
        difficulty_similarity: 5,
        structural_validity: 5,
        answer_correctness: 5,
        topic_alignment: 5,
        distinctness: 4,
        usability: "usable_as_is",
        brief_reason: "ok",
      }),
    });

    await expect(
      reviewVariantExamWithAi(42, {
        baselineAssessmentId: 10,
        variantAssessmentId: 11,
        courseId: 3,
        includeOverallSummary: false,
        cookie: "session=abc",
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
