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

import type { Activity } from "./types";

/**
 * Refusal shown when the last enabled AI mode would be turned off. Every
 * activity must offer students at least one way to ask for help, and the
 * server enforces the same rule.
 *
 * Shared so the add-activity dialog and the per-activity editor say the same
 * thing; both render it under their "AI study buddy" box rather than in a
 * native `alert()`, which was modal, unstyled, and detached from the control
 * that triggered it.
 */
export const AI_MODE_REQUIRED = "At least one AI mode must be enabled.";

/**
 * Refusal shown when an MCQ is submitted with no choice marked correct.
 *
 * The add form used to treat "No correct answer selected yet." as a passive
 * hint and save anyway, silently keying the question to option A — so students
 * were graded against a choice the author never picked.
 */
export const ANSWER_REQUIRED = "Mark one choice as the correct answer.";

export type ActivityFormValues = {
  title: string;
  instructionsMd: string;
  question: string;
  type: "MCQ" | "SHORT_TEXT";
  choices: string[];
  correctIndex: number;
  textAnswer: string;
  hintsText: string;
};

export type ActivityUpdatePayload = {
  title: string | null;
  instructionsMd: string;
  question: string;
  type: "MCQ" | "SHORT_TEXT";
  options: string[] | null;
  answer: any;
  hints: string[];
};

export function ensureChoiceSlots(choices: string[], minimum = 4) {
  const next = [...choices];
  while (next.length < minimum) {
    next.push("");
  }
  return next;
}

export function hintsToTextarea(hints: string[]) {
  if (!Array.isArray(hints) || hints.length === 0) {
    return "";
  }
  return hints.join("\n");
}

export function activityToFormValues(activity: Activity): ActivityFormValues {
  const baseChoices = activity.options?.choices ?? [];
  const normalizedChoices = ensureChoiceSlots(baseChoices);
  const existingCorrectIndex =
    activity.type === "MCQ" && typeof activity.answer?.correctIndex === "number"
      ? activity.answer.correctIndex
      : 0;

  return {
    title: activity.title ?? "",
    instructionsMd: activity.instructionsMd ?? "",
    question: activity.question ?? "",
    type: activity.type,
    choices: normalizedChoices,
    correctIndex:
      existingCorrectIndex >= 0 && existingCorrectIndex < normalizedChoices.length
        ? existingCorrectIndex
        : 0,
    textAnswer:
      activity.type === "SHORT_TEXT" && typeof activity.answer?.text === "string"
        ? activity.answer.text
        : "",
    hintsText: hintsToTextarea(activity.hints ?? []),
  };
}

export function parseHintsInput(value: string) {
  return value
    .split("\n")
    .map((hint) => hint.trim())
    .filter((hint) => hint.length > 0);
}

/**
 * Either a submittable payload or the reason the form is not submittable —
 * one arm or the other, never both. Spelling the two arms out lets a caller
 * that has checked `error` read `payload` without re-checking it.
 */
export type ActivityUpdateResult =
  | { payload: ActivityUpdatePayload; error?: undefined }
  | { payload?: undefined; error: string };

/**
 * Either a compacted MCQ payload or the reason the question is not
 * submittable — one arm or the other, never both, the same shape contract as
 * `ActivityUpdateResult` above. Named rather than spelled inline at each
 * `return` so a caller that has checked `error` reads `options` and
 * `correctIndex` without re-checking them.
 */
export type McqSubmissionResult =
  | { options: string[]; correctIndex: number; error?: undefined }
  | { options?: undefined; correctIndex?: undefined; error: string };

/**
 * Compacts an MCQ's choice list and remaps its answer key, or explains why the
 * question is not submittable.
 *
 * Blank slots are dropped before submission and the surviving `correctIndex` is
 * recomputed against the trimmed list — without this remap, the selected answer
 * would point at the wrong (or a non-existent) choice once gaps are removed.
 *
 * Shared by both authoring paths. The edit form has always done this; the add
 * form did not, so a two-option question reached students as four options with
 * two empty, and a key that had never been remapped.
 */
export function buildMcqSubmission(choices: string[], correctIndex: number): McqSubmissionResult {
  const trimmedChoices = choices.map((choice) => choice.trim());
  const options: string[] = [];
  let nextCorrectIndex = -1;

  trimmedChoices.forEach((choice, index) => {
    if (choice.length > 0) {
      // Capture the correct answer's NEW position in the compacted list
      // before we push — `options.length` here is the pre-push index.
      if (index === correctIndex && nextCorrectIndex === -1) {
        nextCorrectIndex = options.length;
      }
      options.push(choice);
    }
  });

  if (options.length < 2) {
    return { error: "Provide at least two answer choices." };
  }

  if (nextCorrectIndex === -1 || !options[nextCorrectIndex]) {
    return { error: "Select a valid correct answer." };
  }

  return { options, correctIndex: nextCorrectIndex };
}

/**
 * Validates the editor state and produces the canonical update payload, or
 * an error string describing why the form is not yet submittable.
 *
 * MCQ choice compaction and answer remapping are delegated to
 * `buildMcqSubmission`, which the add-activity form shares.
 */
export function buildUpdatePayload(values: ActivityFormValues): ActivityUpdateResult {
  const question = values.question.trim();
  if (!question) {
    return { error: "Question is required." };
  }

  const hints = parseHintsInput(values.hintsText);

  if (values.type === "MCQ") {
    const { options, correctIndex, error } = buildMcqSubmission(
      values.choices,
      values.correctIndex,
    );
    if (error || !options || correctIndex === undefined) {
      return { error: error ?? "Invalid answer choices." };
    }

    return {
      payload: {
        title: values.title.trim().length > 0 ? values.title.trim() : null,
        instructionsMd: values.instructionsMd,
        question,
        type: values.type,
        options,
        answer: { correctIndex },
        hints,
      },
    };
  }

  const textAnswer = values.textAnswer.trim();
  if (!textAnswer) {
    return { error: "Provide the expected answer." };
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
