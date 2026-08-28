import { QuestionDifficulty } from "../types/question";

export type VariantMetadataUpdateInput = {
  isDraft: boolean;
  currentQuestionText: string;
  editQuestionText: string;
  currentDifficulty: QuestionDifficulty;
  editDifficulty: QuestionDifficulty;
};

/**
 * The fields a metadata edit actually changed. Both are optional because the
 * PUT carries only what moved — an empty object means "nothing to send".
 */
export type VariantMetadataUpdates = {
  questionText?: string;
  difficulty?: QuestionDifficulty;
};

/** Build variant PUT payload for metadata edit; empty when reviewed or nothing changed. */
export function buildVariantMetadataUpdates({
  isDraft,
  currentQuestionText,
  editQuestionText,
  currentDifficulty,
  editDifficulty,
}: VariantMetadataUpdateInput): VariantMetadataUpdates {
  if (!isDraft) {
    return {};
  }

  const updates: VariantMetadataUpdates = {};
  const trimmedText = editQuestionText.trim();
  const trimmedCurrent = currentQuestionText.trim();

  if (trimmedText && trimmedText !== trimmedCurrent) {
    updates.questionText = trimmedText;
  }
  if (editDifficulty !== currentDifficulty) {
    updates.difficulty = editDifficulty;
  }

  return updates;
}
