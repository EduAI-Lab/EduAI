/**
 * The activity picker only ever shows questions an author marked usable by
 * other extensions (#1555), and an activity has no faithful representation of a
 * long-answer question — so LA is dropped before it can reach the panel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCourseTestableQuestions = vi.fn();
const listEduAiCourseTopics = vi.fn();

vi.mock("../../src/services/eduaiClient.js", () => ({
  listCourseTestableQuestions: (...args) => listCourseTestableQuestions(...args),
  listEduAiCourseTopics: (...args) => listEduAiCourseTopics(...args),
}));

const { listBankQuestions } = await import("../../src/services/bankQuestions.js");

beforeEach(() => {
  vi.clearAllMocks();
  listEduAiCourseTopics.mockResolvedValue([
    { id: "core-t1", name: "Complexity" },
    { id: "core-t2", name: "Sorting" },
  ]);
  listCourseTestableQuestions.mockResolvedValue([
    {
      id: "q1",
      type: "MCQ",
      content: "What does Big-O measure?",
      topicId: "core-t1",
      choices: [{ letter: "A", text: "Time" }],
      answer: "A",
      difficulty: "MEDIUM",
    },
    {
      id: "q2",
      type: "LA",
      content: "Discuss amortised analysis",
      topicId: "core-t1",
      choices: null,
      answer: null,
      difficulty: "HARD",
    },
    {
      id: "q3",
      type: "SA",
      content: "Define a stable sort",
      topicId: "core-t2",
      choices: null,
      answer: "Preserves order",
      difficulty: "EASY",
    },
  ]);
});

describe("listBankQuestions", () => {
  it("drops long-answer questions, which an activity cannot represent", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions.map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("drops select-all-that-apply MCQs, which an activity's single correctIndex cannot represent", async () => {
    // Core normalizes SATA as answer = first correct letter, correctAnswers =
    // every correct letter. Reading `answer` alone (as the mapper does) would
    // silently mark the activity correct on only one of the real answers, so
    // these are excluded here exactly like LA.
    listCourseTestableQuestions.mockResolvedValue([
      {
        id: "q1",
        type: "MCQ",
        content: "What does Big-O measure?",
        topicId: "core-t1",
        choices: [{ letter: "A", text: "Time" }],
        answer: "A",
        difficulty: "MEDIUM",
      },
      {
        id: "q-sata",
        type: "MCQ",
        content: "Which are sorting algorithms?",
        topicId: "core-t1",
        choices: [
          { letter: "A", text: "Quicksort" },
          { letter: "B", text: "Binary search" },
          { letter: "C", text: "Mergesort" },
        ],
        answer: "A",
        correctAnswers: ["A", "C"],
        selectAllThatApply: true,
        difficulty: "MEDIUM",
      },
    ]);

    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("names each question's topic, so the panel can match it without a per-question fetch", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions[0].topicName).toBe("Complexity");
    expect(result.questions[1].topicName).toBe("Sorting");
    expect(listEduAiCourseTopics).toHaveBeenCalledTimes(1);
  });

  it("leaves topicName null when Core has no topic under that id", async () => {
    listEduAiCourseTopics.mockResolvedValue([]);

    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions[0].topicName).toBeNull();
  });

  it("passes paging and the topic filter through to Core", async () => {
    await listBankQuestions("core-course-1", { topicId: "core-t2", limit: 5, offset: 10 });

    expect(listCourseTestableQuestions).toHaveBeenCalledWith("core-course-1", {
      topicId: "core-t2",
      limit: 5,
      offset: 10,
    });
  });

  it("drops the unused difficulty field from the mapped payload", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions[0]).not.toHaveProperty("difficulty");
  });

  it("reports hasMore false when Core returned fewer than a full page", async () => {
    const result = await listBankQuestions("core-course-1", { limit: 20 });

    expect(result.hasMore).toBe(false);
  });
});

/**
 * Core pages before the LA/SATA filter runs, so asking it for one page and
 * filtering afterwards returned an empty picker whenever the newest questions
 * happened to be unusable — even with plenty of usable ones a page further on
 * (#1652 review). These pin that the window is filled across Core pages.
 */
describe("listBankQuestions page filling", () => {
  const la = (id) => ({ id, type: "LA", content: id, topicId: null, choices: null, answer: null });
  const sa = (id) => ({ id, type: "SA", content: id, topicId: null, choices: null, answer: "x" });

  it("reads past a full page of unusable questions instead of returning empty", async () => {
    listCourseTestableQuestions
      .mockResolvedValueOnce([la("l1"), la("l2")])
      .mockResolvedValueOnce([sa("s1"), sa("s2")]);

    const result = await listBankQuestions("core-course-1", { limit: 2 });

    expect(result.questions.map((q) => q.id)).toEqual(["s1", "s2"]);
    expect(listCourseTestableQuestions).toHaveBeenCalledTimes(2);
    // The second call resumes after the two rows the filter discarded.
    expect(listCourseTestableQuestions.mock.calls[1][1]).toMatchObject({ offset: 2 });
  });

  it("stops at the first short page rather than paging forever", async () => {
    listCourseTestableQuestions
      .mockResolvedValueOnce([la("l1"), la("l2")])
      .mockResolvedValueOnce([sa("s1")]);

    const result = await listBankQuestions("core-course-1", { limit: 2 });

    expect(result.questions.map((q) => q.id)).toEqual(["s1"]);
    expect(result.hasMore).toBe(false);
    expect(listCourseTestableQuestions).toHaveBeenCalledTimes(2);
  });

  it("bounds the scan when every page is unusable", async () => {
    listCourseTestableQuestions.mockResolvedValue([la("l1"), la("l2")]);

    const result = await listBankQuestions("core-course-1", { limit: 2 });

    expect(result.questions).toHaveLength(0);
    // Core never ran out, so the caller is told there may be more rather than
    // being handed a false "that is all there is".
    expect(result.hasMore).toBe(true);
    expect(listCourseTestableQuestions.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("resumes from the rows it consumed, not from offset + limit", async () => {
    // One usable row sits between two discarded ones, so a naive
    // `offset + limit` resume would skip the row after it.
    listCourseTestableQuestions.mockResolvedValueOnce([la("l1"), sa("s1"), la("l2")]);

    const result = await listBankQuestions("core-course-1", { limit: 1, offset: 4 });

    expect(result.questions.map((q) => q.id)).toEqual(["s1"]);
    expect(result.nextOffset).toBe(6);
    expect(result.hasMore).toBe(true);
  });
});
