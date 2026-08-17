/**
 * Question browser for the course Questions tab: a compact filter toolbar, a sort +
 * grid/list view toggle, and a responsive grid of question cards. Creation/upload
 * actions sit in the header; filtering is client-side. The cross-course Question
 * Library (pages/QuestionBankPage) shares the same toolbar for a consistent feel.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, cn, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import {
  IconStack2,
  IconInfoCircle,
  IconFilterX,
  IconPlus,
  IconCompass,
  IconUpload,
  IconLayoutGrid,
  IconLayoutList,
  IconCircleCheck,
} from '@tabler/icons-react';
import { QuestionVariantEntry } from '../../types/question';
import { QuestionCard } from './QuestionCard';
import {
  QuestionFilterToolbar,
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
  type QuestionSort,
} from './QuestionFilterToolbar';
import { CardGridSkeleton } from '@/components/shared/Skeletons';

interface QuestionBankProps {
  variants: QuestionVariantEntry[];
  onViewVariant: (entry: QuestionVariantEntry) => void;
  onCreateVariant: (entry: QuestionVariantEntry) => void;
  onAddQuestion: () => void;
  onUploadQuestions: () => void;
  onRemoveFromBank?: (entry: QuestionVariantEntry) => void;
  /** Marks the supplied draft variants as reviewed. */
  onSetReviewed?: (variantIds: number[]) => Promise<void> | void;
  isLoading?: boolean;
  courseName?: string;
  emptyMessage?: string;
  disableAdd?: boolean;
  disableUpload?: boolean;
  onOpenProfile?: () => void;
  /** Render cards in compact (dense) mode — used by the standalone Question Bank page. */
  compact?: boolean;
}

const timeValue = (entry: QuestionVariantEntry) =>
  new Date(entry.variant.createdAt || entry.variant.updatedAt || 0).getTime();

export const QuestionBank = ({
  variants,
  onViewVariant,
  onCreateVariant,
  onAddQuestion,
  onUploadQuestions,
  onRemoveFromBank,
  isLoading = false,
  courseName,
  emptyMessage,
  disableAdd = false,
  disableUpload = false,
  onOpenProfile,
  compact = false,
  onSetReviewed,
}: QuestionBankProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<QuestionSort>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filters, setFilters] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Record<number, number>>({});
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<number>>(new Set());
  const [reviewingVariantIds, setReviewingVariantIds] = useState<Set<number>>(new Set());

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
    }
    return filtered;
  }, [variants, searchTerm, sortBy, filters]);

  const variantGroups = useMemo(() => {
    const byQuestion = new Map<number, QuestionVariantEntry[]>();
    for (const entry of variants) {
      const list = byQuestion.get(entry.questionId);
      if (list) list.push(entry);
      else byQuestion.set(entry.questionId, [entry]);
    }
    for (const list of byQuestion.values()) {
      list.sort((a, b) => timeValue(a) - timeValue(b) || a.variant.id - b.variant.id);
    }

    const seen = new Set<number>();
    return filteredVariants.flatMap((entry) => {
      if (seen.has(entry.questionId)) return [];
      seen.add(entry.questionId);
      const visibleVariants = filteredVariants.filter((candidate) => candidate.questionId === entry.questionId);
      return [{
        questionId: entry.questionId,
        variants: byQuestion.get(entry.questionId) ?? [entry],
        visibleVariantIds: new Set(visibleVariants.map((candidate) => candidate.variant.id)),
      }];
    });
  }, [filteredVariants, variants]);

  const activeEntryForGroup = (group: {
    questionId: number;
    variants: QuestionVariantEntry[];
    visibleVariantIds: Set<number>;
  }) => {
    const selected = group.variants.find((entry) => entry.variant.id === selectedVariantIds[group.questionId]);
    if (selected && group.visibleVariantIds.has(selected.variant.id)) return selected;
    return group.variants.find((entry) => group.visibleVariantIds.has(entry.variant.id)) ?? group.variants[0];
  };

  useEffect(() => {
    const visibleQuestionIds = new Set(variantGroups.map((group) => group.questionId));
    setSelectedQuestionIds((previous) => {
      const next = new Set(Array.from(previous).filter((id) => visibleQuestionIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [variantGroups]);

  const setActiveVariant = (questionId: number, variantId: string) => {
    setSelectedVariantIds((previous) => ({ ...previous, [questionId]: Number(variantId) }));
  };

  const setQuestionSelected = (questionId: number, selected: boolean) => {
    setSelectedQuestionIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  };

  const handleSetReviewed = async (variantIds: number[]) => {
    if (!onSetReviewed) return;
    const ids = Array.from(new Set(variantIds)).filter((id) => !reviewingVariantIds.has(id));
    if (ids.length === 0) return;
    setReviewingVariantIds((previous) => new Set([...previous, ...ids]));
    try {
      await onSetReviewed(ids);
      setSelectedQuestionIds((previous) => {
        const next = new Set(previous);
        for (const group of variantGroups) {
          const active = activeEntryForGroup(group);
          if (active && ids.includes(active.variant.id)) next.delete(group.questionId);
        }
        return next;
      });
    } finally {
      setReviewingVariantIds((previous) => {
        const next = new Set(previous);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const selectedEntries = variantGroups
    .filter((group) => selectedQuestionIds.has(group.questionId))
    .map(activeEntryForGroup)
    .filter((entry): entry is QuestionVariantEntry => Boolean(entry));
  const selectedDrafts = selectedEntries.filter((entry) => entry.isDraft);
  const visibleDraftQuestionIds = variantGroups
    .map(activeEntryForGroup)
    .filter((entry): entry is QuestionVariantEntry => Boolean(entry && entry.isDraft))
    .map((entry) => entry.questionId);

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
  const totalQuestionCount = new Set(variants.map((entry) => entry.questionId)).size;

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
                ? `${variantGroups.length} of ${new Set(variants.map((entry) => entry.questionId)).size} questions shown`
                : `${totalQuestionCount} question${totalQuestionCount === 1 ? '' : 's'} in this course`}
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

      {onSetReviewed && variantGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {selectedQuestionIds.size > 0 ? `${selectedQuestionIds.size} selected` : 'Select questions for bulk review'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={visibleDraftQuestionIds.length === 0}
            onClick={() => setSelectedQuestionIds(new Set(visibleDraftQuestionIds))}
          >
            <IconCircleCheck className="size-3.5" /> Select drafts
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={selectedDrafts.length === 0 || reviewingVariantIds.size > 0}
            onClick={() => void handleSetReviewed(selectedDrafts.map((entry) => entry.variant.id))}
          >
            <IconCircleCheck className="size-3.5" /> Mark selected reviewed
          </Button>
          {selectedQuestionIds.size > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedQuestionIds(new Set())}>
              Clear selection
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <CardGridSkeleton count={6} columns={view === 'grid' ? 3 : 1} />
      ) : variants.length === 0 ? (
        !courseName && onOpenProfile ? (
          <EmptyState
            icon={<IconInfoCircle className="size-6" />}
            title={emptyMessage || 'No courses available'}
            description="Take a quick guided tour to see how Question Maker works."
            bare={false}
            action={
              <Button onClick={onOpenProfile}>
                <IconCompass className="size-4" />
                Start guided tour
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<IconStack2 className="size-6" />}
            title="No questions yet"
            description={
              emptyMessage || "Add your first question or upload a batch to start building this course's bank."
            }
            bare={false}
            action={
              (!disableAdd || !disableUpload) && (
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                  {!disableAdd && (
                    <Button onClick={onAddQuestion}>
                      <IconPlus className="size-4" />
                      Add question
                    </Button>
                  )}
                  {!disableUpload && (
                    <Button variant="outline" onClick={onUploadQuestions}>
                      Upload
                    </Button>
                  )}
                </div>
              )
            }
          />
        )
      ) : filteredVariants.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconFilterX className="size-6" />}
          title="No questions match your filters"
          description="Try a different search term or clear the filters."
          bare={false}
          action={
            <Button variant="outline" onClick={clearAll}>
              Clear filters
            </Button>
          }
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
          {variantGroups.map((group, index) => {
            const entry = activeEntryForGroup(group);
            if (!entry) return null;
            const variantOptions = group.variants;
            return (
              <div key={group.questionId} className="min-w-0">
                {variantOptions.length > 1 && (
                  <div className="mb-2 flex items-center justify-end gap-2">
                    <span className="text-xs text-muted-foreground">Variant</span>
                    <Select
                      value={String(entry.variant.id)}
                      onValueChange={(value) => setActiveVariant(group.questionId, value)}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs" aria-label={`Select variant for question ${group.questionId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {variantOptions.map((option) => (
                          <SelectItem key={option.variant.id} value={String(option.variant.id)}>
                            {option.variant.referenceId == null
                              ? 'Original'
                              : `Variant ${variantNumbers.get(option.variant.id) ?? ''}`.trim()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <QuestionCard
                  entry={entry}
                  questionNumber={index + 1}
                  variantNumber={variantNumbers.get(entry.variant.id)}
                  onView={onViewVariant}
                  onCreateVariant={onCreateVariant}
                  onRemoveFromBank={onRemoveFromBank}
                  onMarkReviewed={onSetReviewed && entry.isDraft ? () => void handleSetReviewed([entry.variant.id]) : undefined}
                  markingReviewed={reviewingVariantIds.has(entry.variant.id)}
                  selected={selectedQuestionIds.has(group.questionId)}
                  onSelectedChange={onSetReviewed ? (selected) => setQuestionSelected(group.questionId, selected) : undefined}
                  compact={dense}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
