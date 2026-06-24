/** Tailwind classes for MCQ choice rows in question detail view. */
export function getMcqChoiceRowClasses(isCorrect: boolean): string {
  return isCorrect
    ? 'border-success-500 bg-success-100 ring-2 ring-success-500/30'
    : 'border-border bg-muted';
}

export function getMcqChoiceLetterClasses(isCorrect: boolean): string {
  return isCorrect
    ? 'bg-success-500 text-white'
    : 'bg-muted text-foreground';
}

export const CORRECT_ANSWER_SUMMARY_CLASSES =
  'border-success-500 bg-success-100 border-l-4 border-l-success-500';
