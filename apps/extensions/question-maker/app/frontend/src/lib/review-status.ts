/**
 * Confirmation copy for question review-status transitions.
 *
 * Toggling review status is a workflow gate — reviewed questions become exportable and
 * usable in assessments, so an accidental toggle either promotes unvetted content or
 * silently demotes approved content. Both surfaces that expose the toggle (the question
 * dialog footer and the assessment section kebab) confirm through this single helper so
 * the wording cannot drift between them.
 */

export interface ReviewStatusConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  /** reviewed → draft can invalidate downstream export state, so it reads as destructive. */
  variant: 'default' | 'destructive';
}

/**
 * @param nextReviewed the status being moved *to* — `true` marks reviewed, `false` returns to draft.
 */
export function reviewStatusConfirm(nextReviewed: boolean): ReviewStatusConfirmCopy {
  return nextReviewed
    ? {
        title: 'Mark this question as reviewed?',
        description:
          'Reviewed questions can be exported and used in assessments.',
        confirmLabel: 'Mark as reviewed',
        variant: 'default',
      }
    : {
        title: 'Move this question back to draft?',
        description:
          'It will be excluded from export until it is reviewed again.',
        confirmLabel: 'Move to draft',
        variant: 'destructive',
      };
}
