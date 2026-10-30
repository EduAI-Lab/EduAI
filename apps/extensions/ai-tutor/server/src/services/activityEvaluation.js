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
  }
  // SHORT_TEXT is never auto-graded (#2027): a stored answer is only a reference
  // for staff, so `isCorrect` stays null and the attempt waits in Needs grading.

  return {
    isCorrect,
  };
}

export const PENDING_REVIEW_MESSAGE = "Submitted. Your instructor will review this answer.";

/** Student-facing message for a submit result; null means awaiting staff review. */
export function submissionResultMessage(isCorrect) {
  if (isCorrect === true) return "Nice! That looks right.";
  if (isCorrect === false) return "Not quite. Try another angle.";
  return PENDING_REVIEW_MESSAGE;
}

/** Feedback stored after a staff override, so it can't contradict the new result. */
export function overrideFeedbackMessage(isCorrect) {
  if (isCorrect === true) return "Marked correct by your instructor.";
  if (isCorrect === false) return "Marked incorrect by your instructor.";
  return PENDING_REVIEW_MESSAGE;
}
