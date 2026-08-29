/**
 * AI Tutor topics are matched by NAME: topicSync.js ensures topics by name and
 * never writes coreTopicId, so matching on the id would miss every synced topic
 * and duplicate topics that already exist.
 */
import { describe, expect, it } from "vitest";
import { bankQuestionToActivityDraft } from "~/lib/bankQuestionToActivityDraft";

const TOPICS = [
  { id: "local-1", name: "Complexity" },
  { id: "local-2", name: "Sorting" },
];

const MCQ = {
  id: "q1",
  content: "What does Big-O measure?",
  type: "MCQ",
  choices: [
    { letter: "A", text: "Growth rate" },
    { letter: "B", text: "Wall clock time" },
  ],
  answer: "A",
  topicId: "core-t1",
  topicName: "Complexity",
};

describe("bankQuestionToActivityDraft", () => {
  it("carries an MCQ across with its choices and correct answer", () => {
    const draft = bankQuestionToActivityDraft(MCQ, TOPICS);

    expect(draft.type).toBe("MCQ");
    expect(draft.question).toBe("What does Big-O measure?");
    expect(draft.choices).toEqual(["Growth rate", "Wall clock time"]);
    expect(draft.correct).toBe(0);
  });

  it("maps a short-answer question to SHORT_TEXT with its answer", () => {
    const draft = bankQuestionToActivityDraft(
      { ...MCQ, id: "q2", type: "SA", choices: null, answer: "Preserves order" },
      TOPICS,
    );

    expect(draft.type).toBe("SHORT_TEXT");
    expect(draft.choices).toEqual([]);
    expect(draft.correct).toBeNull();
    expect(draft.answer).toBe("Preserves order");
  });

  it("resolves the topic by name", () => {
    const draft = bankQuestionToActivityDraft(MCQ, TOPICS);

    expect(draft.mainTopicId).toBe("local-1");
    expect(draft.unresolvedTopicName).toBeNull();
  });

  it("reports an unmatched topic instead of guessing one", () => {
    const draft = bankQuestionToActivityDraft({ ...MCQ, topicName: "Graphs" }, TOPICS);

    expect(draft.mainTopicId).toBeNull();
    expect(draft.unresolvedTopicName).toBe("Graphs");
  });

  it("does not crash on an MCQ whose correct letter is missing", () => {
    const draft = bankQuestionToActivityDraft({ ...MCQ, answer: null }, TOPICS);

    expect(draft.correct).toBeNull();
    expect(draft.choices).toHaveLength(2);
  });
});
