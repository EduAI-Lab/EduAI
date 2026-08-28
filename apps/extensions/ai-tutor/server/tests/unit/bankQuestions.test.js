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

/**
 * Core clamps `limit` into [1, 500] and falls back to 100 when it is not a
 * finite number (`boundedInteger(limit, 100, 1, 500)` in
 * apps/core/app/lib/questions/server.ts). Asking Core for more than it will
 * ever return and then comparing the page against the *requested* size makes a
 * full page look short, which reads as "that is the end of the bank" and hides
 * every remaining question (#1652 review).
 */
describe("listBankQuestions Core limit clamping", () => {
  const sa = (id) => ({ id, type: "SA", content: id, topicId: null, choices: null, answer: "x" });
  const page = (n, prefix) => Array.from({ length: n }, (_, i) => sa(`${prefix}${i}`));

  it("still reports hasMore when Core clamps an over-max limit to 500", async () => {
    // Core honours 500, not the 501 that was asked for.
    listCourseTestableQuestions.mockResolvedValue(page(500, "a"));

    const result = await listBankQuestions("core-course-1", { limit: 501 });

    expect(result.hasMore).toBe(true);
  });

  it("asks Core for at most the 500 rows it will honour", async () => {
    listCourseTestableQuestions.mockResolvedValue(page(500, "a"));

    await listBankQuestions("core-course-1", { limit: 501 });

    expect(listCourseTestableQuestions.mock.calls[0][1]).toMatchObject({ limit: 500 });
  });

  it("treats a limit below Core's minimum as the single row Core returns", async () => {
    listCourseTestableQuestions.mockResolvedValue(page(1, "a"));

    const result = await listBankQuestions("core-course-1", { limit: 0 });

    expect(listCourseTestableQuestions.mock.calls[0][1]).toMatchObject({ limit: 1 });
    expect(result.questions.map((q) => q.id)).toEqual(["a0"]);
    expect(result.hasMore).toBe(true);
  });

  it("uses Core's own fallback when the limit is not a finite number", async () => {
    listCourseTestableQuestions.mockResolvedValue(page(100, "a"));

    const result = await listBankQuestions("core-course-1", { limit: Number.NaN });

    expect(listCourseTestableQuestions.mock.calls[0][1]).toMatchObject({ limit: 100 });
    expect(result.questions).toHaveLength(100);
    expect(result.hasMore).toBe(true);
  });
});

/**
 * The topic fetch is started before the question paging loop so the two Core
 * reads overlap. Both fail for the same reason — Core unreachable — so the
 * loop rejecting while the topic promise is still in flight is the common
 * path, not a rare interleaving (#1652 review).
 */
describe("listBankQuestions when the topic fetch fails", () => {
  it("still returns questions, with topic names omitted", async () => {
    listEduAiCourseTopics.mockRejectedValue(new Error("EduAI unreachable"));

    const result = await listBankQuestions("core-course-1", {});

    expect(result.questions.map((q) => q.id)).toEqual(["q1", "q3"]);
    expect(result.questions.every((q) => q.topicName === null)).toBe(true);
  });

  it("reports the question failure, with the topic rejection already handled", async () => {
    const topicsRejection = new Error("topics unreachable");
    listEduAiCourseTopics.mockRejectedValue(topicsRejection);
    listCourseTestableQuestions.mockRejectedValue(new Error("questions unreachable"));

    // The abandoned promise is the hazard: the loop throws before
    // `await topicsPromise` is ever reached, so without its own catch the topic
    // rejection has no handler at all.
    await expect(listBankQuestions("core-course-1", {})).rejects.toThrow("questions unreachable");
  });
});
