/**
 * Shared types/constants for the assessment builder views (filters, labels, defaults).
 */
import { QuestionType, ReasoningDataState } from '../../types/question';

export type QuestionSearchFilters = {
  questionTypes: QuestionType[];
  primaryTopicIds: number[];
  secondaryTopicIds: number[];
  excludedTopicIds: number[];
  difficulty?: Array<'easy' | 'medium' | 'hard'> | null;
  reasoningLevel?: Array<'factual' | 'analytical' | 'application'> | null;
};

export type DeleteActionType =
  | { type: 'section'; item: any }
  | { type: 'variant'; sectionId: number; variantId: number }
  | null;

export const QUESTION_TYPES: QuestionType[] = ['MCQ', 'SA', 'LA'];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Multiple Choice',
  SA: 'Short Answer',
  LA: 'Long Answer'
};

export const defaultReasoningData = (): ReasoningDataState => ({
  factual: { total: 40, easyBoundary: 60, hardBoundary: 90 },
  analytical: { total: 35, easyBoundary: 50, hardBoundary: 80 },
  application: { total: 25, easyBoundary: 40, hardBoundary: 70 }
});
