/**
 * @file Pure helpers translating between an `Activity` and its editor form values.
 *
 * Responsibility: Converts server `Activity` records into MCQ/SHORT_TEXT form
 *   state and back into the canonical update payload that
 *   `api.updateActivity` expects.
 * Callers: Instructor activity editor components.
 * Gotchas:
 *   - When MCQ choices are submitted, blank entries are dropped and the
 *     remaining list is re-indexed; `correctIndex` MUST be re-mapped to its
 *     new position (see `buildUpdatePayload`). This invariant is the most
 *     bug-prone part of the form.
 *   - Output of `buildUpdatePayload` is the shape `api.updateActivity`
 *     accepts; do not re-wrap `options` here.
 * Related: `app/lib/api.ts` (`updateActivity`), `app/lib/types.ts` (`Activity`).
 */

import type { Activity } from './types';

export type ActivityFormValues = {
  title: string;
  instructionsMd: string;
  question: string;
  type: 'MCQ' | 'SHORT_TEXT';
  choices: string[];
  correctIndex: number;
  textAnswer: string;
  hintsText: string;
};

export type ActivityUpdatePayload = {
  title: string | null;
  instructionsMd: string;
  question: string;
  type: 'MCQ' | 'SHORT_TEXT';
  options: string[] | null;
  answer: any;
  hints: string[];
};

export function ensureChoiceSlots(choices: string[], minimum = 4) {
  const next = [...choices];
  while (next.length < minimum) {
    next.push('');
  }
  return next;
}

export function hintsToTextarea(hints: string[]) {
  if (!Array.isArray(hints) || hints.length === 0) {
    return '';
  }
  return hints.join('\n');
}

export function activityToFormValues(activity: Activity): ActivityFormValues {
  const baseChoices = activity.options?.choices ?? [];
  const normalizedChoices = ensureChoiceSlots(baseChoices);
  const existingCorrectIndex =
    activity.type === 'MCQ' && typeof activity.answer?.correctIndex === 'number'
      ? activity.answer.correctIndex
      : 0;

  return {
    title: activity.title ?? '',
    instructionsMd: activity.instructionsMd ?? '',
    question: activity.question ?? '',
    type: activity.type,
    choices: normalizedChoices,
    correctIndex:
      existingCorrectIndex >= 0 && existingCorrectIndex < normalizedChoices.length
        ? existingCorrectIndex
        : 0,
    textAnswer:
      activity.type === 'SHORT_TEXT' && typeof activity.answer?.text === 'string'
        ? activity.answer.text
        : '',
    hintsText: hintsToTextarea(activity.hints ?? []),
  };
}

export function parseHintsInput(value: string) {
  return value
    .split('\n')
    .map((hint) => hint.trim())
    .filter((hint) => hint.length > 0);
}

/**
 * Validates the editor state and produces the canonical update payload, or
 * an error string describing why the form is not yet submittable.
 *
 * For MCQ activities, blank choices are stripped before submission and the
 * surviving `correctIndex` is recomputed against the trimmed list — without
 * this remap, the previously selected answer would point at the wrong (or
 * non-existent) choice once gaps are removed.
 */
export function buildUpdatePayload(values: ActivityFormValues): {
  payload?: ActivityUpdatePayload;
  error?: string;
} {
  const question = values.question.trim();
  if (!question) {
    return { error: 'Question is required.' };
  }

  const hints = parseHintsInput(values.hintsText);

  if (values.type === 'MCQ') {
    const trimmedChoices = values.choices.map((choice) => choice.trim());
    const options: string[] = [];
    let nextCorrectIndex = -1;

    trimmedChoices.forEach((choice, index) => {
      if (choice.length > 0) {
        // Capture the correct answer's NEW position in the compacted list
        // before we push — `options.length` here is the pre-push index.
        if (index === values.correctIndex && nextCorrectIndex === -1) {
          nextCorrectIndex = options.length;
        }
        options.push(choice);
      }
    });

    if (options.length < 2) {
      return { error: 'Provide at least two answer choices.' };
    }

    if (nextCorrectIndex === -1 || !options[nextCorrectIndex]) {
      return { error: 'Select a valid correct answer.' };
    }

    return {
      payload: {
        title: values.title.trim().length > 0 ? values.title.trim() : null,
        instructionsMd: values.instructionsMd,
        question,
        type: values.type,
        options,
        answer: { correctIndex: nextCorrectIndex },
        hints,
      },
    };
  }

  const textAnswer = values.textAnswer.trim();
  if (!textAnswer) {
    return { error: 'Provide the expected answer.' };
  }

  return {
    payload: {
      title: values.title.trim().length > 0 ? values.title.trim() : null,
      instructionsMd: values.instructionsMd,
      question,
      type: values.type,
      options: null,
      answer: { text: textAnswer },
      hints,
    },
  };
}
