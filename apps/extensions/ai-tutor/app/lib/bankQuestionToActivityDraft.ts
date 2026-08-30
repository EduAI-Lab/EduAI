/**
 * Turns a shared bank question into the draft the Add Activity form holds.
 *
 * Pure on purpose: the panel's prefill is the part most likely to be wrong in a
 * way tests can catch, and it should be testable without rendering the panel.
 *
 * Topic matching is by NAME, not `coreTopicId`: `topicSync.js` ensures AI Tutor
 * topics by name and never writes `coreTopicId`, so the id would match nothing.
 * This function never creates a topic — for an imported course, sync owns that
 * table — it reports an unmatched name and lets the caller refresh and retry.
 */
export interface BankQuestion {
  id: string;
  content: string;
  type: string;
  choices: Array<{ letter: string; text: string }> | null;
  answer: string | null;
  topicId: string | null;
  topicName: string | null;
}

export interface ActivityDraft {
  type: "MCQ" | "SHORT_TEXT";
  question: string;
  choices: string[];
  correct: number | null;
  answer: string;
  mainTopicId: string | null;
  unresolvedTopicName: string | null;
}

export function bankQuestionToActivityDraft(
  question: BankQuestion,
  topics: Array<{ id: string; name: string }>,
): ActivityDraft {
  const isMcq = question.type === "MCQ";
  const choices = isMcq ? (question.choices ?? []) : [];
  const correctIndex = choices.findIndex((choice) => choice.letter === question.answer);
  const match = topics.find((topic) => topic.name === question.topicName);

  return {
    type: isMcq ? "MCQ" : "SHORT_TEXT",
    question: question.content,
    choices: choices.map((choice) => choice.text),
    correct: correctIndex >= 0 ? correctIndex : null,
    answer: isMcq ? "" : (question.answer ?? ""),
    mainTopicId: match ? match.id : null,
    unresolvedTopicName: match ? null : question.topicName,
  };
}
