/**
 * Panel that lists matching questions for a section search, supporting selection and variant actions.
 * Sorts selected questions to the top and shows review toggles for each variant.
 */
import { useMemo } from 'react';
import { Question } from '../../types/question';
import { Topic } from '../../types/topic';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { QuestionMetadataCard } from '../../components/assessments/QuestionMetadataCard';

interface MatchingQuestionsPanelProps {
  questions: Question[];
  selectedQuestionIds: Set<number>;
  onToggleQuestion: (question: Question) => void;
  onClearSelection: () => void;
  onAddVariant: (question: Question) => void;
  onViewQuestion?: (question: Question, variantId?: number) => void;
  onToggleReview: (variantId: number, nextDraft: boolean) => void;
  isSearching: boolean;
  searchError: string | null;
  hasSearched: boolean;
  topicsById: Record<number, Topic>;
  selectedVariantByQuestion?: Record<number, number>;
  onVariantChange?: (questionId: number, variantId: number) => void;
}

export const MatchingQuestionsPanel = ({
  questions,
  selectedQuestionIds,
  onToggleQuestion,
  onClearSelection,
  onAddVariant,
  onViewQuestion,
  onToggleReview,
  isSearching,
  searchError,
  hasSearched,
  topicsById,
  selectedVariantByQuestion,
  onVariantChange
}: MatchingQuestionsPanelProps) => {
  const selectedCount = selectedQuestionIds.size;

  // Sort questions to put selected ones first
  const sortedQuestions = useMemo(() => {
    const selected: Question[] = [];
    const unselected: Question[] = [];

    questions.forEach((question) => {
      if (selectedQuestionIds.has(question.id)) {
        selected.push(question);
      } else {
        unselected.push(question);
      }
    });

    return [...selected, ...unselected];
  }, [questions, selectedQuestionIds]);

  const renderContent = () => {
    if (isSearching) {
      return (
        <div className="rounded border border-dashed border-gray-200 p-6 text-center text-sm text-muted-foreground">
          Searching for matching questions…
        </div>
      );
    }

    if (searchError) {
      return (
        <div className="rounded border border-red-100 bg-red-50 p-4 text-sm text-red-600">
          {searchError}
        </div>
      );
    }

    if (!hasSearched) {
      return (
        <div className="rounded border border-dashed border-gray-200 p-6 text-center text-sm text-muted-foreground">
          Configure filters and run "Search Questions" to see matches here.
        </div>
      );
    }

    if (questions.length === 0) {
      return (
        <div className="rounded border border-dashed border-gray-200 p-6 text-center text-sm text-muted-foreground">
          No questions matched your filters. Try broadening the search or create a new question.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
          {sortedQuestions.map((question) => {
            const isSelected = selectedQuestionIds.has(question.id);

            return (
              <QuestionMetadataCard
                key={question.id}
                question={question}
                isSelected={isSelected}
                onToggleSelection={() => onToggleQuestion(question)}
                onAddVariant={() => onAddVariant(question)}
                topicsById={topicsById}
                onToggleReview={onToggleReview}
                onViewQuestion={onViewQuestion}
                selectedVariantId={selectedVariantByQuestion?.[question.id]}
                onVariantChange={onVariantChange}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className="border border-gray-200" data-tour-id="builder-matching-questions">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Matching Questions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Filtered results from your course question bank.
          </p>
        </div>
        <Badge variant="outline">{questions.length} found</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderContent()}
        {selectedCount > 0 && (
          <div className="flex items-center gap-3 border-t pt-4 text-sm text-muted-foreground">
            <span>{selectedCount} selected</span>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear selection
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
