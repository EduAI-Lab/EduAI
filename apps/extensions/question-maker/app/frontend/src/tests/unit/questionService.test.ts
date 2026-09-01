/**
 * Unit tests for `questionService` (#1546): the variant/question normalizers
 * (camelCase vs. snake_case backend payloads), the offset-pagination walk in
 * `getQuestions`, filter-param assembly in `getQuestionsPage`, and the
 * remaining CRUD/AI wrappers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();

vi.mock("../../services/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

import { questionService } from "../../services/questionService";

afterEach(() => {
  vi.clearAllMocks();
});

function pageEnvelope(items: unknown[], total: number, limit: number, offset: number) {
  return { data: { data: { items, total, limit, offset } } };
}

describe("questionService.getQuestion / mapQuestion / mapVariant normalization", () => {
  it("normalizes a camelCase variant payload", async () => {
    get.mockResolvedValue({
      data: {
        data: {
          id: 1,
          description: "d",
          type: "MCQ",
          courseId: 1,
          primaryTopicId: 2,
          createdAt: "a",
          updatedAt: "b",
          course: { id: 1, name: "C", code: "C1" },
          variants: [
            {
              id: 10,
              questionText: "Q",
              difficulty: "hard",
              reasoningLevel: "analytical",
              answer: "A",
              choices: [{ letter: "A", text: "x" }],
              selectAllThatApply: true,
              correctAnswers: ["A"],
              questionMetadataId: 1,
              assessmentId: 5,
              secondaryTopicsId: ["t1"],
              referenceId: 3,
              isAiGenerated: true,
              isDraft: false,
              coreQuestionId: "core-1",
              testable: true,
              createdBy: "author-1",
              createdAt: "a",
              updatedAt: "b",
              assessment: {
                id: 5,
                name: "Midterm",
                type: "Midterm",
                semester: "F",
                createdAt: "a",
                updatedAt: "b",
              },
            },
          ],
        },
      },
    });

    const question = await questionService.getQuestion(1);
    expect(question.variants[0]).toEqual({
      id: 10,
      questionText: "Q",
      difficulty: "hard",
      reasoningLevel: "analytical",
      answer: "A",
      choices: [{ letter: "A", text: "x" }],
      selectAllThatApply: true,
      correctAnswers: ["A"],
      questionMetadataId: 1,
      assessmentId: 5,
      secondaryTopicsId: ["t1"],
      referenceId: 3,
      isAiGenerated: true,
      isDraft: false,
      coreQuestionId: "core-1",
      testable: true,
      createdBy: "author-1",
      createdAt: "a",
      updatedAt: "b",
      assessment: {
        id: 5,
        name: "Midterm",
        type: "Midterm",
        semester: "F",
        createdAt: "a",
        updatedAt: "b",
      },
    });
    expect(question.course).toEqual({ id: 1, name: "C", code: "C1" });
  });

  it("normalizes a snake_case variant payload with sensible defaults", async () => {
    get.mockResolvedValue({
      data: {
        data: {
          id: 1,
          type: "SA",
          courseId: 1,
          primaryTopicId: null,
          createdAt: "a",
          updatedAt: "b",
          variants: [
            {
              id: 11,
              questionText: "Q2",
              choices: { letter: "A", text: "single" },
              reasoning_level: "factual",
              select_all_that_apply: false,
              correct_answers: ["B"],
              question_metadata_id: 2,
              secondary_topics_id: ["t2"],
              reference_id: 4,
              is_ai_generated: false,
              is_draft: true,
              core_question_id: null,
              created_at: "a",
              updated_at: "b",
            },
          ],
        },
      },
    });

    const question = await questionService.getQuestion(1);
    const variant = question.variants[0];
    expect(variant.difficulty).toBe("medium");
    expect(variant.choices).toEqual([{ letter: "A", text: "single" }]);
    expect(variant.reasoningLevel).toBe("factual");
    expect(variant.correctAnswers).toEqual(["B"]);
    expect(variant.questionMetadataId).toBe(2);
    expect(variant.secondaryTopicsId).toEqual(["t2"]);
    expect(variant.referenceId).toBe(4);
    expect(variant.isDraft).toBe(true);
    expect(variant.assessment).toBeUndefined();
  });

  it("defaults description/course/variants when absent", async () => {
    get.mockResolvedValue({
      data: {
        data: {
          id: 2,
          type: "MCQ",
          courseId: 1,
          primaryTopicId: 1,
          createdAt: "a",
          updatedAt: "b",
        },
      },
    });
    const question = await questionService.getQuestion(2);
    expect(question.description).toBeNull();
    expect(question.course).toBeUndefined();
    expect(question.variants).toEqual([]);
  });
});

describe("questionService.getQuestionsPage", () => {
  it("assembles only the provided filter params, joining array filters", async () => {
    get.mockResolvedValue(pageEnvelope([], 0, 50, 0));
    await questionService.getQuestionsPage({
      courseId: 1,
      questionBankId: "b1",
      search: "term",
      types: ["MCQ", "SA"],
      difficulties: ["easy"],
      reasoningLevels: ["factual", "analytical"],
      aiGenerated: "ai",
      draftStatus: "draft",
      sortBy: "oldest",
      limit: 10,
      offset: 5,
    });
    expect(get).toHaveBeenCalledWith("/api/questions", {
      params: {
        courseId: 1,
        questionBankId: "b1",
        search: "term",
        types: "MCQ,SA",
        difficulties: "easy",
        reasoningLevels: "factual,analytical",
        aiGenerated: "ai",
        draftStatus: "draft",
        sortBy: "oldest",
        limit: 10,
        offset: 5,
      },
    });
  });

  it("omits default-valued filters (all/newest) from params", async () => {
    get.mockResolvedValue(pageEnvelope([], 0, 50, 0));
    await questionService.getQuestionsPage({
      aiGenerated: "all",
      draftStatus: "all",
      sortBy: "newest",
    });
    expect(get).toHaveBeenCalledWith("/api/questions", { params: {} });
  });

  it("unwraps a legacy bare array response", async () => {
    get.mockResolvedValue({
      data: {
        data: [
          { id: 1, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" },
        ],
      },
    });
    const page = await questionService.getQuestionsPage();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it("defaults to an empty page for an unrecognized payload shape", async () => {
    get.mockResolvedValue({ data: { data: null } });
    const page = await questionService.getQuestionsPage();
    expect(page).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });
});

describe("questionService.getQuestions", () => {
  it("returns a single page's items when limit is within the server max", async () => {
    get.mockResolvedValue(
      pageEnvelope(
        [{ id: 1, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" }],
        1,
        50,
        0,
      ),
    );
    const items = await questionService.getQuestions({ limit: 50 });
    expect(items).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("walks all offset pages when no limit is given, preserving filters", async () => {
    get
      .mockResolvedValueOnce(
        pageEnvelope(
          [{ id: 1, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" }],
          2,
          1,
          0,
        ),
      )
      .mockResolvedValueOnce(
        pageEnvelope(
          [{ id: 2, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" }],
          2,
          1,
          1,
        ),
      );

    const items = await questionService.getQuestions({ courseId: 1, search: "x" });
    expect(items.map((q) => q.id)).toEqual([1, 2]);
    expect(get).toHaveBeenNthCalledWith(1, "/api/questions", {
      params: { courseId: 1, search: "x", limit: 100, offset: 0 },
    });
  });

  it("throws when the result set exceeds the fetch-all safety cap", async () => {
    get.mockResolvedValue(
      pageEnvelope(
        Array.from({ length: 100 }, (_, i) => ({
          id: i,
          type: "MCQ",
          courseId: 1,
          primaryTopicId: 1,
          createdAt: "a",
          updatedAt: "b",
        })),
        1_000_000,
        100,
        0,
      ),
    );
    await expect(questionService.getQuestions({})).rejects.toThrow(/fetch-all safety cap/);
  });
});

describe("questionService CRUD/variant wrappers", () => {
  it("createQuestion posts and normalizes the response", async () => {
    post.mockResolvedValue({
      data: {
        data: {
          id: 1,
          type: "MCQ",
          courseId: 1,
          primaryTopicId: 1,
          createdAt: "a",
          updatedAt: "b",
        },
      },
    });
    const q = await questionService.createQuestion({ type: "MCQ" } as any);
    expect(post).toHaveBeenCalledWith("/api/questions", { type: "MCQ" });
    expect(q.id).toBe(1);
  });

  it("updateQuestion puts and normalizes the response", async () => {
    put.mockResolvedValue({
      data: {
        data: {
          id: 1,
          type: "MCQ",
          courseId: 1,
          primaryTopicId: 1,
          createdAt: "a",
          updatedAt: "b",
        },
      },
    });
    await questionService.updateQuestion(1, { type: "MCQ" });
    expect(put).toHaveBeenCalledWith("/api/questions/1", { type: "MCQ" });
  });

  it("deleteQuestion deletes by id", async () => {
    del.mockResolvedValue({});
    await questionService.deleteQuestion(1);
    expect(del).toHaveBeenCalledWith("/api/questions/1");
  });

  it("createVariant posts and normalizes the response", async () => {
    post.mockResolvedValue({ data: { data: { id: 1, questionText: "Q" } } });
    const v = await questionService.createVariant(1, { questionText: "Q" });
    expect(post).toHaveBeenCalledWith("/api/questions/1/variants", { questionText: "Q" });
    expect(v.questionText).toBe("Q");
  });

  it("updateVariant puts and normalizes the response", async () => {
    put.mockResolvedValue({ data: { data: { id: 1, questionText: "Q2" } } });
    await questionService.updateVariant(1, { questionText: "Q2" });
    expect(put).toHaveBeenCalledWith("/api/questions/variants/1", { questionText: "Q2" });
  });

  it("deleteVariant deletes by id", async () => {
    del.mockResolvedValue({});
    await questionService.deleteVariant(1);
    expect(del).toHaveBeenCalledWith("/api/questions/variants/1");
  });

  it("setVariantTestable patches the testable flag", async () => {
    patch.mockResolvedValue({ data: { data: { id: "1", testable: true } } });
    await expect(questionService.setVariantTestable(1, true)).resolves.toEqual({
      id: "1",
      testable: true,
    });
    expect(patch).toHaveBeenCalledWith("/api/questions/variants/1/testable", { testable: true });
  });

  it("generateQuestions posts params and returns data", async () => {
    post.mockResolvedValue({ data: { data: [{ id: 1 }] } });
    await expect(questionService.generateQuestions({} as any)).resolves.toEqual([{ id: 1 }]);
  });

  it("approveQuestions posts questions/courseId and normalizes results", async () => {
    post.mockResolvedValue({
      data: {
        data: [
          { id: 1, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" },
        ],
      },
    });
    const result = await questionService.approveQuestions([{ id: 1 } as any], 5);
    expect(post).toHaveBeenCalledWith("/api/questions/approve", {
      questions: [{ id: 1 }],
      courseId: 5,
    });
    expect(result).toHaveLength(1);
  });

  it("approveQuestions defaults to an empty array when data is missing", async () => {
    post.mockResolvedValue({ data: {} });
    await expect(questionService.approveQuestions([])).resolves.toEqual([]);
  });

  it("getQuestionStats forwards courseId when given", async () => {
    get.mockResolvedValue({ data: { data: { totalQuestions: 5 } } });
    await questionService.getQuestionStats({ courseId: 3 });
    expect(get).toHaveBeenCalledWith("/api/questions/stats", { params: { courseId: 3 } });
  });

  it("getQuestionStats omits courseId when not given", async () => {
    get.mockResolvedValue({ data: { data: {} } });
    await questionService.getQuestionStats();
    expect(get).toHaveBeenCalledWith("/api/questions/stats", { params: {} });
  });

  it("extractQuestionsFromText posts payload and defaults to an empty array", async () => {
    post.mockResolvedValue({ data: {} });
    await expect(
      questionService.extractQuestionsFromText({ text: "t", courseId: 1 }),
    ).resolves.toEqual([]);
  });

  it("saveExtractedQuestions posts payload and normalizes the questions/assessmentId", async () => {
    post.mockResolvedValue({
      data: {
        data: {
          questions: [
            { id: 1, type: "MCQ", courseId: 1, primaryTopicId: 1, createdAt: "a", updatedAt: "b" },
          ],
          assessmentId: 9,
        },
      },
    });
    const result = await questionService.saveExtractedQuestions({ courseId: 1, questions: [] });
    expect(result.assessmentId).toBe(9);
    expect(result.questions).toHaveLength(1);
  });

  it("saveExtractedQuestions defaults assessmentId to null and questions to empty", async () => {
    post.mockResolvedValue({ data: { data: {} } });
    const result = await questionService.saveExtractedQuestions({ courseId: 1, questions: [] });
    expect(result).toEqual({ questions: [], assessmentId: null });
  });
});
