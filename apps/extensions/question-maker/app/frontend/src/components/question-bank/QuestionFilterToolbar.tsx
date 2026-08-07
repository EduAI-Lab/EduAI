/**
 * Shared filter toolbar for every question-browsing surface (course Questions tab
 * and the cross-course Question Library). One compact row: search · optional course ·
 * sort · a Filters popover. Active filters surface as removable chips below so the
 * applied state is always visible. Replaces the old heavy "Search & Filters" card and
 * its fixed-position dropdown hack (which detached on scroll).
 */
import { type ReactNode } from 'react';
import {
  Input,
  Button,
  Badge,
  Checkbox,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Separator,
  cn,
} from '@eduai/ui';
import { IconSearch, IconFilter, IconX, IconArrowsSort } from '@tabler/icons-react';
import { QuestionType, QuestionDifficulty, ReasoningLevel } from '../../types/question';

export interface QuestionFilters {
  questionTypes: QuestionType[];
  reasoningLevels: ReasoningLevel[];
  difficulties: QuestionDifficulty[];
  aiGenerated: 'all' | 'ai' | 'not-ai';
  draftStatus: 'all' | 'draft' | 'reviewed';
}

/** Server-backed sorts only — difficulty lives on variants and isn't orderable in SQL yet. */
export type QuestionSort = 'newest' | 'oldest' | 'type';

export const EMPTY_QUESTION_FILTERS: QuestionFilters = {
  questionTypes: [],
  reasoningLevels: [],
  difficulties: [],
  aiGenerated: 'all',
  draftStatus: 'all',
};

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'MCQ', label: 'Multiple choice' },
  { value: 'SA', label: 'Short answer' },
  { value: 'LA', label: 'Long answer' },
];
const DIFFICULTY_OPTIONS: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const REASONING_OPTIONS: ReasoningLevel[] = ['factual', 'analytical', 'application'];

const SORT_LABELS: Record<QuestionSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  type: 'By type',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function countActiveFilters(filters: QuestionFilters): number {
  return (
    filters.questionTypes.length +
    filters.reasoningLevels.length +
    filters.difficulties.length +
    (filters.aiGenerated !== 'all' ? 1 : 0) +
    (filters.draftStatus !== 'all' ? 1 : 0)
  );
}

interface CheckRowsProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}
function CheckRows<T extends string>({ options, selected, onToggle }: CheckRowsProps<T>) {
  return (
    <div className="space-y-0.5">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <Checkbox checked={selected.includes(opt.value)} onCheckedChange={() => onToggle(opt.value)} />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

/** A small segmented control for the tri-state (all / a / b) filters. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            value === opt.value
              ? 'bg-card text-foreground shadow-[var(--shadow-2xs)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface CourseOption {
  value: string;
  label: string;
}

interface QuestionFilterToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filters: QuestionFilters;
  onFiltersChange: (filters: QuestionFilters) => void;
  searchPlaceholder?: string;
  /** Sort control — omit to hide. */
  sortBy?: QuestionSort;
  onSortChange?: (sort: QuestionSort) => void;
  /** Cross-course course filter — omit to hide (course-scoped surfaces don't need it). */
  courseOptions?: CourseOption[];
  courseValue?: string;
  onCourseChange?: (value: string) => void;
  /** Extra controls rendered at the end of the row (e.g. a view toggle). */
  trailing?: ReactNode;
}

const COURSE_ALL = '__all__';

export function QuestionFilterToolbar({
  searchTerm,
  onSearchChange,
  filters,
  onFiltersChange,
  searchPlaceholder = 'Search questions or topics…',
  sortBy,
  onSortChange,
  courseOptions,
  courseValue = COURSE_ALL,
  onCourseChange,
  trailing,
}: QuestionFilterToolbarProps) {
  const activeCount = countActiveFilters(filters);
  const selectedCourse = courseOptions?.find((c) => c.value === courseValue);

  const toggle = <K extends 'questionTypes' | 'reasoningLevels' | 'difficulties'>(
    key: K,
    value: QuestionFilters[K][number],
  ) => {
    const current = filters[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [key]: next });
  };

  const clearAll = () => onFiltersChange(EMPTY_QUESTION_FILTERS);

  // Build the removable chip list from the active filter state.
  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...filters.questionTypes.map((t) => ({
      key: `type-${t}`,
      label: TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t,
      onRemove: () => toggle('questionTypes', t),
    })),
    ...filters.difficulties.map((d) => ({
      key: `diff-${d}`,
      label: cap(d),
      onRemove: () => toggle('difficulties', d),
    })),
    ...filters.reasoningLevels.map((r) => ({
      key: `reason-${r}`,
      label: cap(r),
      onRemove: () => toggle('reasoningLevels', r),
    })),
    ...(filters.aiGenerated !== 'all'
      ? [
          {
            key: 'ai',
            label: filters.aiGenerated === 'ai' ? 'AI-generated' : 'Written manually',
            onRemove: () => onFiltersChange({ ...filters, aiGenerated: 'all' }),
          },
        ]
      : []),
    ...(filters.draftStatus !== 'all'
      ? [
          {
            key: 'status',
            label: filters.draftStatus === 'draft' ? 'Draft' : 'Reviewed',
            onRemove: () => onFiltersChange({ ...filters, draftStatus: 'all' }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
            aria-label="Search questions"
          />
        </div>

        {courseOptions && onCourseChange && (
          <Select value={courseValue} onValueChange={onCourseChange}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by course">
              <SelectValue>{selectedCourse?.label ?? 'All courses'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={COURSE_ALL}>All courses</SelectItem>
              {courseOptions.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {sortBy && onSortChange && (
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as QuestionSort)}>
            <SelectTrigger className="gap-1.5 sm:w-44" aria-label="Sort questions">
              <IconArrowsSort className="size-4 text-muted-foreground" />
              <SelectValue>{SORT_LABELS[sortBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as QuestionSort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <IconFilter className="size-4" />
              Filters
              {activeCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 justify-center px-1.5">
                  {activeCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold">Filters</span>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs font-medium text-primary-text hover:underline"
                >
                  Reset
                </button>
              )}
            </div>
            <Separator />
            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</p>
                <CheckRows
                  options={TYPE_OPTIONS}
                  selected={filters.questionTypes}
                  onToggle={(v) => toggle('questionTypes', v)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Difficulty</p>
                <CheckRows
                  options={DIFFICULTY_OPTIONS.map((d) => ({ value: d, label: cap(d) }))}
                  selected={filters.difficulties}
                  onToggle={(v) => toggle('difficulties', v)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reasoning</p>
                <CheckRows
                  options={REASONING_OPTIONS.map((r) => ({ value: r, label: cap(r) }))}
                  selected={filters.reasoningLevels}
                  onToggle={(v) => toggle('reasoningLevels', v)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</p>
                <Segmented
                  value={filters.aiGenerated}
                  onChange={(v) => onFiltersChange({ ...filters, aiGenerated: v })}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'ai', label: 'AI' },
                    { value: 'not-ai', label: 'Manual' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review status</p>
                <Segmented
                  value={filters.draftStatus}
                  onChange={(v) => onFiltersChange({ ...filters, draftStatus: v })}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'reviewed', label: 'Reviewed' },
                  ]}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {trailing}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-1 pl-2.5 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {chip.label}
              <IconX className="size-3 text-muted-foreground" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
