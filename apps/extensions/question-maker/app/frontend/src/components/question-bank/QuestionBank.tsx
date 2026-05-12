/**
 * Question bank list with search/sort controls, add/upload actions, and variant cards.
 * Filters variants client-side and exposes callbacks for viewing/creating variants.
 */
import { useState, useMemo } from 'react';
import { QuestionVariantEntry, QuestionType, QuestionDifficulty, ReasoningLevel } from '../../types/question';
import { QuestionCard } from './QuestionCard';
import { SearchAndFilters, QuestionFilters } from './SearchAndFilters';
import { QuestionBankHeader } from './QuestionBankHeader';
import { Loader2, User, Info } from 'lucide-react';
import { Button } from '../ui/button';

interface QuestionBankProps {
  variants: QuestionVariantEntry[];
  onViewVariant: (entry: QuestionVariantEntry) => void;
  onCreateVariant: (entry: QuestionVariantEntry) => void;
  onAddQuestion: () => void;
  onUploadQuestions: () => void;
  isLoading?: boolean;
  courseName?: string;
  emptyMessage?: string;
  disableAdd?: boolean;
  disableUpload?: boolean;
  onOpenProfile?: () => void;
}

export const QuestionBank = ({
  variants,
  onViewVariant,
  onCreateVariant,
  onAddQuestion,
  onUploadQuestions,
  isLoading = false,
  courseName,
  emptyMessage,
  disableAdd = false,
  disableUpload = false,
  onOpenProfile
}: QuestionBankProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'type'>('newest');
  const [filters, setFilters] = useState<QuestionFilters>({
    questionTypes: [],
    reasoningLevels: [],
    difficulties: [],
    aiGenerated: 'all',
    draftStatus: 'all'
  });

  const filteredVariants = useMemo(() => {
    let filtered = [...variants];

    // Apply text search filter
    if (searchTerm) {
      const lowered = searchTerm.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.variant.questionText.toLowerCase().includes(lowered) ||
        entry.questionDescription?.toLowerCase().includes(lowered)
      );
    }

    // Apply question type filter
    if (filters.questionTypes.length > 0) {
      filtered = filtered.filter((entry) =>
        filters.questionTypes.includes(entry.questionType)
      );
    }

    // Apply reasoning level filter
    if (filters.reasoningLevels.length > 0) {
      filtered = filtered.filter((entry) =>
        entry.variant.reasoningLevel &&
        filters.reasoningLevels.includes(entry.variant.reasoningLevel)
      );
    }

    // Apply difficulty filter
    if (filters.difficulties.length > 0) {
      filtered = filtered.filter((entry) =>
        filters.difficulties.includes(entry.variant.difficulty)
      );
    }

    // Apply AI generated filter
    if (filters.aiGenerated !== 'all') {
      if (filters.aiGenerated === 'ai') {
        filtered = filtered.filter((entry) => entry.isAiGenerated === true);
      } else {
        filtered = filtered.filter((entry) => entry.isAiGenerated !== true);
      }
    }

    // Apply draft status filter
    if (filters.draftStatus !== 'all') {
      if (filters.draftStatus === 'draft') {
        filtered = filtered.filter((entry) => entry.isDraft === true);
      } else {
        filtered = filtered.filter((entry) => entry.isDraft !== true);
      }
    }

    // Apply sorting
    switch (sortBy) {
      case 'newest':
        filtered.sort((a, b) =>
          new Date(b.variant.createdAt || b.variant.updatedAt || b.variant.id).getTime() -
          new Date(a.variant.createdAt || a.variant.updatedAt || a.variant.id).getTime()
        );
        break;
      case 'oldest':
        filtered.sort((a, b) =>
          new Date(a.variant.createdAt || a.variant.updatedAt || a.variant.id).getTime() -
          new Date(b.variant.createdAt || b.variant.updatedAt || b.variant.id).getTime()
        );
        break;
      case 'type':
        filtered.sort((a, b) => a.questionType.localeCompare(b.questionType));
        break;
    }

    return filtered;
  }, [variants, searchTerm, sortBy, filters]);

  return (
    <div className="space-y-6">
      <QuestionBankHeader
        questionCount={filteredVariants.length}
        courseName={courseName}
        onAddQuestion={onAddQuestion}
        onUploadQuestions={onUploadQuestions}
        disableAdd={disableAdd}
        disableUpload={disableUpload}
      />

      {variants.length > 0 && (
        <SearchAndFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading questions...
        </div>
      ) : (
        <div className="space-y-3" data-tour-id="question-list">
          {filteredVariants.map((entry, index) => (
            <QuestionCard
              key={`${entry.questionId}-${entry.variant.id}`}
              entry={entry}
              questionNumber={index + 1}
              onView={onViewVariant}
              onCreateVariant={onCreateVariant}
            />
          ))}

          {filteredVariants.length === 0 && (
            <div className="text-center py-8">
              {!courseName && onOpenProfile ? (
                <div className="flex flex-col items-center space-y-4 py-4">
                  <div className="flex items-center gap-2 text-blue-600">
                    <Info className="h-5 w-5" />
                    <p className="text-gray-700 font-medium">{emptyMessage || 'No courses available.'}</p>
                  </div>
                  <Button onClick={onOpenProfile} className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    <span>Start Guided Tour</span>
                  </Button>
                </div>
              ) : (
                <p className="text-gray-500">{emptyMessage || 'No variants available for this course yet.'}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
