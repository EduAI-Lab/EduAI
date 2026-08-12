/** @param {{ selectAllThatApply?: boolean, answer?: string|null, correctAnswers?: string[]|null, choiceLetters: string[] }} input */
export function normalizeMcqCorrectness({ selectAllThatApply = false, answer, correctAnswers, choiceLetters }) {
  const allowed = new Set(choiceLetters.map((l) => String(l).trim().toUpperCase()).filter(Boolean));

  const coerceLetter = (raw) => {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Prefer leading letter like existing extractAnswerLetter callers may pass
    const letter = s.length === 1 ? s.toUpperCase() : s.charAt(0).toUpperCase();
    return letter;
  };

  if (!selectAllThatApply) {
    const letter = coerceLetter(answer);
    if (!letter) throw new Error('MCQ requires at least one correct answer');
    if (!allowed.has(letter)) throw new Error(`Correct answer ${letter} is not in choices`);
    return { selectAllThatApply: false, answer: letter, correctAnswers: null };
  }

  const fromArray = Array.isArray(correctAnswers) ? correctAnswers : [];
  const unique = [...new Set(fromArray.map(coerceLetter).filter(Boolean))].sort();
  if (unique.length === 0) throw new Error('MCQ requires at least one correct answer');
  for (const letter of unique) {
    if (!allowed.has(letter)) throw new Error(`Correct answer ${letter} is not in choices`);
  }
  return {
    selectAllThatApply: true,
    answer: unique[0],
    correctAnswers: unique,
  };
}
