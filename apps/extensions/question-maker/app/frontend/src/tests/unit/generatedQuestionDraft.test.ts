/**
 * Unit tests for the generated-question → composer form mapping (#1973).
 * Shared by single and batch generation, so both paths normalise identically.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHOICES,
  applyGeneratedQuestion,
  inferGeneratedType,
  type GeneratedDraftFields,
  type GeneratedQuestion,
} from "@/lib/generatedQuestionDraft";

const prev: GeneratedDraftFields = {
  questionType: "MCQ",
  questionText: "",
  difficulty: "medium",
  reasoningLevel: "factual",
  answer: "",
  choices: DEFAULT_CHOICES.map((c) => ({ ...c })),
  primaryTopicId: "t0",
  secondaryTopicIds: [],
  description: "",
};
const gen = (overrides: Partial<GeneratedQuestion> = {}) =>
  ({ content: "Q?", ...overrides }) as GeneratedQuestion;
const topicIds = ["1", "2", "3"];

describe("inferGeneratedType", () => {
  it("falls back to MCQ for an unknown type", () => {
    expect(inferGeneratedType(gen({ type: "ESSAY" as any }))).toBe("MCQ");
    expect(inferGeneratedType(gen({ type: "SA" }))).toBe("SA");
  });
});

describe("applyGeneratedQuestion (create)", () => {
  it("normalises difficulty, reasoning and topics", () => {
    const next = applyGeneratedQuestion(
      prev,
      gen({
        difficulty: "weird" as any,
        reasoning_level: "analytical",
        primary_topic_id: 2,
        secondary_topic_ids: [2, 3, 3, 9],
      }),
      topicIds,
      "create",
    );
    expect(next.difficulty).toBe("medium");
    expect(next.reasoningLevel).toBe("analytical");
    expect(next.primaryTopicId).toBe("2");
    expect(next.secondaryTopicIds).toEqual(["3"]);
  });

  it("keeps the previous primary topic when the generated one is unknown", () => {
    const next = applyGeneratedQuestion(prev, gen({ primary_topic_id: 42 }), topicIds, "create");
    expect(next.primaryTopicId).toBe("t0");
  });

  it("cleans MCQ choices and falls back when fewer than two survive", () => {
    const cleaned = applyGeneratedQuestion(
      prev,
      gen({
        type: "MCQ",
        choices: [
          { letter: "a", text: " x " },
          { letter: "b", text: "y" },
          { letter: "c", text: "  " },
        ],
      }),
      topicIds,
      "create",
    );
    expect(cleaned.choices).toEqual([
      { letter: "A", text: "x" },
      { letter: "B", text: "y" },
    ]);
    const fallback = applyGeneratedQuestion(
      prev,
      gen({ type: "MCQ", choices: [{ letter: "A", text: "only" }] }),
      topicIds,
      "create",
    );
    expect(fallback.choices).toBe(prev.choices);
  });

  it("resets choices for non-MCQ and derives a description from content", () => {
    const next = applyGeneratedQuestion(
      prev,
      gen({ type: "SA", content: "What is recursion? Explain." }),
      topicIds,
      "create",
    );
    expect(next.questionType).toBe("SA");
    expect(next.choices).toEqual(DEFAULT_CHOICES);
    expect(next.description).toBe("What is recursion?");
  });
});

describe("applyGeneratedQuestion (variant)", () => {
  it("keeps type, primary topic, description and a non-empty previous answer", () => {
    const base = { ...prev, questionType: "SA" as const, description: "base", answer: "keep" };
    const next = applyGeneratedQuestion(
      base,
      gen({ type: "MCQ", primary_topic_id: 1, answer: " " }),
      topicIds,
      "variant",
    );
    expect(next.questionType).toBe("SA");
    expect(next.primaryTopicId).toBe("t0");
    expect(next.description).toBe("base");
    expect(next.answer).toBe("keep");
  });
});
