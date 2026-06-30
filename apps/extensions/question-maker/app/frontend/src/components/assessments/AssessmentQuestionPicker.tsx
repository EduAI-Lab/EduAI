/**
 * "Select questions" picker — opens from the assessment builder's Add-questions action.
 * Left rail: search + type / difficulty pill toggles + topic filters. Right: a scrollable,
 * multi-select list of the course's questions. Built on @eduai/ui primitives and the shared
 * difficulty palette so it matches the rest of the redesigned surfaces (dark-mode safe).
 */
import { useMemo, useState } from 'react';
import {
  Button,
  Input,
  Label,
  ScrollArea,
  Separator,
  Badge,
  Checkbox,
  Combobox,
  MultiSelect,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@eduai/ui';
import { IconSearch, IconFilterOff, IconListCheck, IconCheck } from '@tabler/icons-react';
import { QuestionDifficulty, QuestionType, QuestionVariantEntry, Topic } from '../../types/question';
import { difficultyChipClass } from '../../lib/difficulty';

interface AssessmentQuestionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionBank: QuestionVariantEntry[];
  excludeVariantIds: number[];
  topics: Topic[];
  onConfirm: (variantIds: number[]) => void;
}

type PickerFilter = {
  types: QuestionType[];
  difficulties: QuestionDifficulty[];
  primaryTopicId: string;
  secondaryTopicIds: string[];
  search: string;
};

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'MCQ', label: 'Multiple choice' },
  { value: 'SA', label: 'Short answer' },
  { value: 'LA', label: 'Long answer' },
];
const DIFFICULTIES: QuestionDifficulty[] = ['easy', 'medium', 'hard'];

const EMPTY_FILTER: PickerFilter = {
  types: [],
  difficulties: [],
  primaryTopicId: '',
  secondaryTopicIds: [],
  search: '',
};

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

export function AssessmentQuestionPicker({
  open,
  onOpenChange,
  questionBank,
  excludeVariantIds,
  topics,
  onConfirm,
}: AssessmentQuestionPickerProps) {
  const [filter, setFilter] = useState<PickerFilter>(EMPTY_FILTER);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const availableQuestions = useMemo(
    () => questionBank.filter((q) => !excludeVariantIds.includes(q.variant.id)),
    [questionBank, excludeVariantIds],
  );

  const filteredQuestions = useMemo(() => {
    return availableQuestions.filter((entry) => {
      if (filter.types.length > 0 && !filter.types.includes(entry.questionType)) return false;
      if (filter.difficulties.length > 0 && !filter.difficulties.includes(entry.variant.difficulty)) return false;
      if (filter.primaryTopicId && entry.primaryTopicId.toString() !== filter.primaryTopicId) return false;
      if (filter.secondaryTopicIds.length > 0) {
        const variantSecondary = entry.variant.secondaryTopicsId ?? [];
        if (!filter.secondaryTopicIds.some((id) => variantSecondary.includes(id))) return false;
      }
      if (filter.search.trim()) {
        const needle = filter.search.toLowerCase();
        const haystack = `${entry.variant.questionText} ${entry.questionDescription ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [availableQuestions, filter]);

  const hasActiveFilters =
    filter.types.length > 0 ||
    filter.difficulties.length > 0 ||
    !!filter.primaryTopicId ||
    filter.secondaryTopicIds.length > 0 ||
    filter.search.trim().length > 0;

  const toggleType = (type: QuestionType) =>
    setFilter((prev) => ({
      ...prev,
      types: prev.types.includes(type) ? prev.types.filter((t) => t !== type) : [...prev.types, type],
    }));

  const toggleDifficulty = (diff: QuestionDifficulty) =>
    setFilter((prev) => ({
      ...prev,
      difficulties: prev.difficulties.includes(diff)
        ? prev.difficulties.filter((d) => d !== diff)
        : [...prev.difficulties, diff],
    }));

  const handleToggleQuestion = (variantId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  };

  const allFilteredSelected = selected.size === filteredQuestions.length && filteredQuestions.length > 0;
  const handleSelectAll = () => {
    if (allFilteredSelected) setSelected(new Set());
    else setSelected(new Set(filteredQuestions.map((q) => q.variant.id)));
  };

  const handleClearFilters = () => setFilter(EMPTY_FILTER);

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setSelected(new Set());
      handleClearFilters();
    }
    onOpenChange(openState);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
    setSelected(new Set());
    handleClearFilters();
  };

  const topicOptions = useMemo(
    () => topics.map((t) => ({ value: t.id.toString(), label: t.name })),
    [topics],
  );

  // Secondary topics can't include the chosen primary topic.
  const secondaryTopicOptions = useMemo(
    () => topicOptions.filter((o) => o.value !== filter.primaryTopicId),
    [topicOptions, filter.primaryTopicId],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex h-[82vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-secondary to-accent text-white shadow-[var(--shadow-sm)]">
              <IconListCheck className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-foreground">Select questions</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {availableQuestions.length} available question{availableQuestions.length === 1 ? '' : 's'} in this course
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: filters */}
          <div className="flex w-[264px] shrink-0 flex-col overflow-hidden border-r border-border bg-muted/20">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className={SECTION_LABEL}>Filters</span>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <IconFilterOff className="size-3.5" />
                  Clear
                </Button>
              )}
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-5 p-4">
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filter.search}
                    onChange={(e) => setFilter((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search question text"
                    className="h-9 pl-8 text-sm"
                    aria-label="Search questions"
                  />
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>Type</span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUESTION_TYPES.map(({ value, label }) => {
                      const active = filter.types.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleType(value)}
                          aria-pressed={active}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                            active
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-border text-muted-foreground hover:border-accent/50 hover:text-foreground',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className={SECTION_LABEL}>Difficulty</span>
                  <div className="flex flex-wrap gap-1.5">
                    {DIFFICULTIES.map((diff) => {
                      const active = filter.difficulties.includes(diff);
                      return (
                        <button
                          key={diff}
                          type="button"
                          onClick={() => toggleDifficulty(diff)}
                          aria-pressed={active}
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                            active
                              ? difficultyChipClass[diff]
                              : 'border-border text-muted-foreground hover:border-accent/50 hover:text-foreground',
                          )}
                        >
                          {diff}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <span className={SECTION_LABEL}>Primary topic</span>
                  <Combobox
                    options={topicOptions}
                    value={filter.primaryTopicId || null}
                    onValueChange={(v) =>
                      setFilter((prev) => ({
                        ...prev,
                        primaryTopicId: v ?? '',
                        secondaryTopicIds: prev.secondaryTopicIds.filter((id) => id !== v),
                      }))
                    }
                    placeholder="All topics"
                    searchPlaceholder="Search topics…"
                    emptyText="No topics"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className={SECTION_LABEL}>Secondary topics</span>
                  <MultiSelect
                    options={secondaryTopicOptions}
                    value={filter.secondaryTopicIds}
                    onValueChange={(ids) => setFilter((prev) => ({ ...prev, secondaryTopicIds: ids }))}
                    placeholder="All topics"
                    searchPlaceholder="Search topics…"
                    emptyText="No topics"
                  />
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Right: question list */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm text-muted-foreground">
                {filteredQuestions.length} match{filteredQuestions.length === 1 ? '' : 'es'}
                {selected.size > 0 && <span className="ml-1.5 font-semibold text-primary-text">· {selected.size} selected</span>}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={filteredQuestions.length === 0}
              >
                {allFilteredSelected ? 'Clear selection' : 'Select all'}
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              {filteredQuestions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                  <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <IconSearch className="size-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No questions match</p>
                  <p className="text-xs text-muted-foreground">
                    {hasActiveFilters ? 'Try clearing or loosening the filters.' : 'This course has no questions to add yet.'}
                  </p>
                  {hasActiveFilters && (
                    <Button type="button" variant="outline" size="sm" onClick={handleClearFilters} className="mt-1 gap-1.5">
                      <IconFilterOff className="size-3.5" /> Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2 p-3">
                  {filteredQuestions.map((entry) => {
                    const checked = selected.has(entry.variant.id);
                    const topicName = entry.primaryTopicName || topics.find((t) => t.id === entry.primaryTopicId)?.name;
                    const diff = entry.variant.difficulty as QuestionDifficulty | undefined;
                    return (
                      <button
                        key={entry.variant.id}
                        type="button"
                        onClick={() => handleToggleQuestion(entry.variant.id)}
                        aria-pressed={checked}
                        className={cn(
                          'flex items-start gap-3 rounded-[var(--radius-lg)] border px-3.5 py-3 text-left transition-colors',
                          checked
                            ? 'border-accent bg-accent/10'
                            : 'border-border bg-card hover:border-accent/40 hover:bg-muted/40',
                        )}
                      >
                        <Checkbox checked={checked} className="pointer-events-none mt-0.5" tabIndex={-1} aria-hidden />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="line-clamp-2 text-sm leading-relaxed text-foreground">{entry.variant.questionText}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="muted" size="sm" className="capitalize">
                              {entry.questionType}
                            </Badge>
                            {diff && (
                              <span
                                className={cn(
                                  'inline-flex h-[18px] items-center rounded-full border px-2 text-[10px] font-medium capitalize',
                                  difficultyChipClass[diff],
                                )}
                              >
                                {diff}
                              </span>
                            )}
                            {topicName && (
                              <span className="max-w-[12rem] truncate text-[11px] text-muted-foreground">{topicName}</span>
                            )}
                          </div>
                        </div>
                        {checked && <IconCheck className="mt-0.5 size-4 shrink-0 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="mt-0 shrink-0 sm:items-center sm:justify-between gap-2 border-t border-border px-6 py-4">
          <span className="text-sm text-muted-foreground">
            {selected.size} question{selected.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={selected.size === 0} className="gap-1.5">
              <IconCheck className="size-4" />
              Add {selected.size > 0 ? selected.size : ''} question{selected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
