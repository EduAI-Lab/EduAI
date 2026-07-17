/**
 * Question browser for the course Questions tab: a compact filter toolbar, a sort +
 * grid/list view toggle, and a responsive grid of question cards. Creation/upload
 * actions sit in the header; filtering is client-side. The cross-course Question
 * Library (pages/QuestionBankPage) shares the same toolbar for a consistent feel.
 */
import { useMemo, useState } from 'react';
import { Button, cn } from '@eduai/ui';
import {
  IconStack2,
  IconInfoCircle,
  IconFilterX,
  IconPlus,
  IconCompass,
  IconUpload,
  IconLayoutGrid,
  IconLayoutList,
  IconRefresh,
} from '@tabler/icons-react';
import { QuestionVariantEntry } from '../../types/question';
import { QuestionCard } from './QuestionCard';
import { BankSelector } from './BankSelector';
import type { QuestionBank as QuestionBankModel } from '../../services/questionBankService';
import {
  QuestionFilterToolbar,
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
  type QuestionSort,
} from './QuestionFilterToolbar';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardGridSkeleton } from '@/components/shared/Skeletons';

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
  /** Render cards in compact (dense) mode — used by the standalone Question Bank page. */
  compact?: boolean;
  banks?: QuestionBankModel[];
  selectedBankId?: string | null;
  onBankChange?: (id: string | null) => void;
  onCreateBank?: (name: string) => void | Promise<void>;
  onSyncFromCanvas?: () => void;
  pendingQuestionIds?: Set<number> | number[];
  disableBankControls?: boolean;
}

const timeValue = (entry: QuestionVariantEntry) =>
  new Date(entry.variant.createdAt || entry.variant.updatedAt || 0).getTime();

const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

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
  onOpenProfile,
  compact = false,
  banks = [],
  selectedBankId = null,
  onBankChange,
  onCreateBank,
  onSyncFromCanvas,
  pendingQuestionIds,
  disableBankControls = false,
}: QuestionBankProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<QuestionSort>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filters, setFilters] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);

  const pendingIds = useMemo(() => {
    if (!pendingQuestionIds) return null;
    return pendingQuestionIds instanceof Set
      ? pendingQuestionIds
      : new Set(pendingQuestionIds);
  }, [pendingQuestionIds]);

  const showBankControls = Boolean(onBankChange && onCreateBank);

  // Every variant shares its base question's id, so a card needs an ordinal — "Variant 2
  // of #4" — to be distinguishable. Number the non-base variants of each question (a base
  // variant has referenceId == null) in creation order.
  const variantNumbers = useMemo(() => {
    const byQuestion = new Map<number, QuestionVariantEntry[]>();
    for (const entry of variants) {
      const list = byQuestion.get(entry.questionId);
      if (list) list.push(entry);
      else byQuestion.set(entry.questionId, [entry]);
    }
    const numbers = new Map<number, number>(); // variant.id -> ordinal
    for (const list of byQuestion.values()) {
      const sorted = [...list].sort((a, b) => timeValue(a) - timeValue(b) || a.variant.id - b.variant.id);
      let n = 0;
      for (const entry of sorted) {
        if (entry.variant.referenceId != null) numbers.set(entry.variant.id, ++n);
      }
    }
    return numbers;
  }, [variants]);

  const filteredVariants = useMemo(() => {
    let filtered = [...variants];
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (entry) =>
          entry.variant.questionText.toLowerCase().includes(term) ||
          entry.questionDescription?.toLowerCase().includes(term) ||
          entry.primaryTopicName?.toLowerCase().includes(term),
      );
    }
    if (filters.questionTypes.length > 0) {
      filtered = filtered.filter((entry) => filters.questionTypes.includes(entry.questionType));
    }
    if (filters.reasoningLevels.length > 0) {
      filtered = filtered.filter(
        (entry) =>
          entry.variant.reasoningLevel && filters.reasoningLevels.includes(entry.variant.reasoningLevel),
      );
    }
    if (filters.difficulties.length > 0) {
      filtered = filtered.filter((entry) => filters.difficulties.includes(entry.variant.difficulty));
    }
    if (filters.aiGenerated !== 'all') {
      const wantAi = filters.aiGenerated === 'ai';
      filtered = filtered.filter((entry) => (entry.isAiGenerated === true) === wantAi);
    }
    if (filters.draftStatus !== 'all') {
      const wantDraft = filters.draftStatus === 'draft';
      filtered = filtered.filter((entry) => (entry.isDraft === true) === wantDraft);
    }

    switch (sortBy) {
      case 'newest':
        filtered.sort((a, b) => timeValue(b) - timeValue(a));
        break;
      case 'oldest':
        filtered.sort((a, b) => timeValue(a) - timeValue(b));
        break;
      case 'type':
        filtered.sort((a, b) => a.questionType.localeCompare(b.questionType));
        break;
      case 'difficulty':
        filtered.sort(
          (a, b) =>
            (DIFFICULTY_RANK[a.variant.difficulty] ?? 1) - (DIFFICULTY_RANK[b.variant.difficulty] ?? 1),
        );
        break;
    }
    return filtered;
  }, [variants, searchTerm, sortBy, filters]);

  const hasFilters =
    searchTerm.trim() !== '' ||
    filters.questionTypes.length > 0 ||
    filters.reasoningLevels.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.aiGenerated !== 'all' ||
    filters.draftStatus !== 'all';

  const clearAll = () => {
    setSearchTerm('');
    setFilters(EMPTY_QUESTION_FILTERS);
  };

  const dense = compact || view === 'grid';

  return (
    <div className="space-y-4">
      {/* Header: count + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Questions</h2>
          <p className="text-sm text-muted-foreground">
            {variants.length === 0
              ? 'No questions yet'
              : hasFilters
                ? `${filteredVariants.length} of ${variants.length} shown`
                : `${variants.length} question${variants.length === 1 ? '' : 's'} in this course`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!disableUpload && (
            <Button
              variant="outline"
              onClick={onUploadQuestions}
              className="gap-1.5"
              data-tour-id="upload-questions-btn"
            >
              <IconUpload className="size-4" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
          )}
          {!disableAdd && (
            <Button onClick={onAddQuestion} className="gap-1.5" data-tour-id="add-question-btn">
              <IconPlus className="size-4" />
              Add question
            </Button>
          )}
        </div>
      </div>

      {showBankControls && (
        <div className="flex flex-wrap items-center gap-3">
          <BankSelector
            banks={banks}
            selectedBankId={selectedBankId}
            onBankChange={onBankChange!}
            onCreateBank={onCreateBank!}
            disabled={disableBankControls}
          />
          {onSyncFromCanvas && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={disableBankControls}
              onClick={onSyncFromCanvas}
              data-testid="sync-bank-from-canvas"
            >
              <IconRefresh className="size-4" />
              Sync from Canvas
            </Button>
          )}
        </div>
      )}

      {variants.length > 0 && (
        <QuestionFilterToolbar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filters={filters}
          onFiltersChange={setFilters}
          sortBy={sortBy}
          onSortChange={setSortBy}
          trailing={
            <div className="hidden items-center rounded-lg border border-border p-0.5 sm:inline-flex">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md transition-colors',
                  view === 'grid'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <IconLayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md transition-colors',
                  view === 'list'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <IconLayoutList className="size-4" />
              </button>
            </div>
          }
        />
      )}

      {isLoading ? (
        <CardGridSkeleton count={6} columns={view === 'grid' ? 3 : 1} />
      ) : variants.length === 0 ? (
        !courseName && onOpenProfile ? (
          <EmptyState
            icon={<IconInfoCircle className="size-6" />}
            title={emptyMessage || 'No courses available'}
            description="Take a quick guided tour to see how Question Maker works."
            primaryAction={{
              label: 'Start guided tour',
              onClick: onOpenProfile,
              icon: <IconCompass className="size-4" />,
            }}
          />
        ) : (
          <EmptyState
            icon={<IconStack2 className="size-6" />}
            title="No questions yet"
            description={
              emptyMessage || "Add your first question or upload a batch to start building this course's bank."
            }
            primaryAction={
              !disableAdd
                ? { label: 'Add question', onClick: onAddQuestion, icon: <IconPlus className="size-4" /> }
                : undefined
            }
            secondaryAction={!disableUpload ? { label: 'Upload', onClick: onUploadQuestions } : undefined}
          />
        )
      ) : filteredVariants.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconFilterX className="size-6" />}
          title="No questions match your filters"
          description="Try a different search term or clear the filters."
          primaryAction={{ label: 'Clear filters', onClick: clearAll, variant: 'outline' }}
        />
      ) : (
        <div
          className={cn(
            view === 'grid'
              ? 'grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-3',
          )}
          data-tour-id="question-list"
        >
          {filteredVariants.map((entry, index) => (
            <QuestionCard
              key={`${entry.questionId}-${entry.variant.id}`}
              entry={entry}
              questionNumber={index + 1}
              variantNumber={variantNumbers.get(entry.variant.id)}
              onView={onViewVariant}
              onCreateVariant={onCreateVariant}
              compact={dense}
              isPending={pendingIds?.has(entry.questionId) ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
};
