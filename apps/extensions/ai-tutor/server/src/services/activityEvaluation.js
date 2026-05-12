export function evaluateQuestion(activity, payload) {
  const config = activity.config ?? {};
  const questionType = config.questionType ?? 'MCQ';
  let isCorrect = null;

  if (questionType === 'MCQ') {
    const expected =
      typeof config.answer === 'number' ? config.answer : config.answer?.correctIndex;
    if (typeof expected === 'number' && typeof payload.answerOption === 'number') {
      isCorrect = expected === payload.answerOption;
    }
  } else if (questionType === 'SHORT_TEXT') {
    const expected =
      typeof config.answer === 'string'
        ? config.answer
        : config.answer?.text
          ? String(config.answer.text)
          : '';
    if (typeof payload.answerText === 'string') {
      isCorrect =
        expected && payload.answerText.trim().toLowerCase() === expected.trim().toLowerCase();
    }
  }

  return {
    isCorrect,
  };
}
