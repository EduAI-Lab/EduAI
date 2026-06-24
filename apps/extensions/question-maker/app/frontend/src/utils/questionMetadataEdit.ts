import { QuestionDifficulty } from '../types/question';

export type VariantMetadataUpdateInput = {
  isDraft: boolean;
  currentQuestionText: string;
  editQuestionText: string;
  currentDifficulty: QuestionDifficulty;
  editDifficulty: QuestionDifficulty;
};

/** Build variant PUT payload for metadata edit; empty when reviewed or nothing changed. */
export function buildVariantMetadataUpdates({
  isDraft,
  currentQuestionText,
  editQuestionText,
  currentDifficulty,
  editDifficulty,
}: VariantMetadataUpdateInput): { questionText?: string; difficulty?: QuestionDifficulty } {
  if (!isDraft) {
    return {};
  }

  const updates: { questionText?: string; difficulty?: QuestionDifficulty } = {};
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
