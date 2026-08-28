export function evaluateQuestion(activity, payload) {
  const config = activity.config ?? {};
  const questionType = config.questionType ?? "MCQ";
  let isCorrect = null;

  if (questionType === "MCQ") {
    const expected =
      typeof config.answer === "number" ? config.answer : config.answer?.correctIndex;
    if (typeof expected === "number" && typeof payload.answerOption === "number") {
      isCorrect = expected === payload.answerOption;
    }
  } else if (questionType === "SHORT_TEXT") {
    const expected =
      typeof config.answer === "string"
        ? config.answer
        : config.answer?.text
          ? String(config.answer.text)
          : "";
    // An open-ended short-text question (no configured answer key) cannot be
    // auto-graded, so `isCorrect` stays `null` — the submission is left for a
    // human to grade (it appears in the staff "to review" queue). Only compare
    // when there is an answer key AND a submitted string; otherwise the old
    // `expected && …` yielded `""` (an empty string, not a boolean or null),
    // which the `Submission.isCorrect Boolean?` column rejects.
    if (expected && typeof payload.answerText === "string") {
      isCorrect = payload.answerText.trim().toLowerCase() === expected.trim().toLowerCase();
    }
  }

  return {
    isCorrect,
  };
}
