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

    expect(result.map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("names each question's topic, so the panel can match it without a per-question fetch", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result[0].topicName).toBe("Complexity");
    expect(result[1].topicName).toBe("Sorting");
    expect(listEduAiCourseTopics).toHaveBeenCalledTimes(1);
  });

  it("leaves topicName null when Core has no topic under that id", async () => {
    listEduAiCourseTopics.mockResolvedValue([]);

    const result = await listBankQuestions("core-course-1", {});

    expect(result[0].topicName).toBeNull();
  });

  it("passes paging and the topic filter through to Core", async () => {
    await listBankQuestions("core-course-1", { topicId: "core-t2", limit: 5, offset: 10 });

    expect(listCourseTestableQuestions).toHaveBeenCalledWith("core-course-1", {
      topicId: "core-t2",
      limit: 5,
      offset: 10,
    });
  });
});
