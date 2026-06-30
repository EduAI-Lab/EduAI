/**
 * Shared MCQ correct-answer matching.
 *
 * A variant's `answer` may be stored either as a choice letter ("B") or as the
 * full choice text ("Paris"), depending on how the question was authored or
 * imported. Renderers must mark exactly ONE choice correct. Matching each choice
 * independently by "letter OR text" caused accidental double-marking:
 *   - an empty answer ("") matched every blank-text choice ("" === ""), and
 *   - a letter answer ("A") also matched any other choice whose text was "A".
 *
 * `markCorrectChoices` resolves correctness against the whole choice list: it
 * prefers a letter match, and only falls back to text matching when the answer
 * is not any choice's letter. An empty/whitespace answer marks nothing correct.
 */
import type { MCQChoice } from '../types/question';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Returns a boolean per choice (same order as `choices`) indicating the single
 * correct choice. At most one entry is true unless choices contain genuine
 * duplicates of the answer.
 */
export function markCorrectChoices(
  answer: string | null | undefined,
  choices: Pick<MCQChoice, 'letter' | 'text'>[]
): boolean[] {
  const a = norm(answer);
  if (a === '') return choices.map(() => false);

  const matchesLetter = choices.some((c) => norm(c.letter) === a);
  return choices.map((c) => (matchesLetter ? norm(c.letter) === a : norm(c.text) === a));
}
