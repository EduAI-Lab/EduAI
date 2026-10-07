/**
 * Question browser for the course Questions tab and the bank detail page: a compact
 * filter toolbar, a sort + grid/list view toggle, and a responsive grid of question
 * cards. It is controlled — the page owns search/filters/sort and sends them to the
 * server with limit/offset so totals stay correct (#1762). The only client-side step
 * hides variants of a matched question that fail variant-level filters.
 */
import { useMemo, useState } from "react";
import { Button, cn, EmptyState } from "@eduai/ui";
import {
  IconStack2,
  IconInfoCircle,
  IconFilterX,
  IconPlus,
  IconCompass,
  IconUpload,
  IconLayoutGrid,
  IconLayoutList,
} from "@tabler/icons-react";
import { QuestionVariantEntry } from "../../types/question";
import { QuestionCard } from "./QuestionCard";
import {
  QuestionFilterToolbar,
  EMPTY_QUESTION_FILTERS,
  countActiveFilters,
  type BankOption,
  type QuestionFilters,
  type QuestionSort,
} from "./QuestionFilterToolbar";
import { variantMatchesFilters } from "./questionListFilters";
import { CardGridSkeleton } from "@/components/shared/Skeletons";

interface QuestionBankProps {
  variants: QuestionVariantEntry[];
  /** Server total for the current filters (questions, not variant cards). */
  total: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filters: QuestionFilters;
  onFiltersChange: (filters: QuestionFilters) => void;
  sortBy: QuestionSort;
  onSortChange: (sort: QuestionSort) => void;
  /** Bank facet options — omit on surfaces fixed to one bank. */
  bankOptions?: BankOption[];
  onViewVariant: (entry: QuestionVariantEntry) => void;
  onCreateVariant: (entry: QuestionVariantEntry) => void;
  onAddQuestion: () => void;
  onUploadQuestions: () => void;
  onRemoveFromBank?: (entry: QuestionVariantEntry) => void;
  onMoveToBank?: (entry: QuestionVariantEntry) => void;
  onAddToBank?: (entry: QuestionVariantEntry) => void;
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
  total,
  searchTerm,
  onSearchChange,
  filters,
  onFiltersChange,
  sortBy,
  onSortChange,
  bankOptions,
  onViewVariant,
  onCreateVariant,
  onAddQuestion,
  onUploadQuestions,
  onRemoveFromBank,
  onMoveToBank,
  onAddToBank,
  isLoading = false,
  courseName,
  emptyMessage,
  disableAdd = false,
  disableUpload = false,
  onOpenProfile,
  compact = false,
}: QuestionBankProps) => {
  const [view, setView] = useState<"grid" | "list">("grid");

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
      const sorted = [...list].sort(
        (a, b) => timeValue(a) - timeValue(b) || a.variant.id - b.variant.id,
      );
      let n = 0;
      for (const entry of sorted) {
        if (entry.variant.referenceId != null) numbers.set(entry.variant.id, ++n);
      }
    }
    return numbers;
  }, [variants]);

  const visibleVariants = useMemo(
    () => variants.filter((entry) => variantMatchesFilters(entry, searchTerm, filters)),
    [variants, searchTerm, filters],
  );

  const hasFilters = searchTerm.trim() !== "" || countActiveFilters(filters) > 0;

  const clearAll = () => {
    onSearchChange("");
    onFiltersChange(EMPTY_QUESTION_FILTERS);
  };

  const dense = compact || view === "grid";

  return (
    <div className="space-y-4">
      {/* Header: count + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Questions</h2>
          <p className="text-sm text-muted-foreground">
            {hasFilters
              ? `${total} matching`
              : total === 0
                ? "No questions yet"
                : `${total} question${total === 1 ? "" : "s"} in this course`}
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

      {(variants.length > 0 || hasFilters) && (
        <QuestionFilterToolbar
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          filters={filters}
          onFiltersChange={onFiltersChange}
          sortBy={sortBy}
          onSortChange={onSortChange}
          bankOptions={bankOptions}
          trailing={
            <div className="hidden items-center rounded-lg border border-border p-0.5 sm:inline-flex">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  view === "grid"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <IconLayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  view === "list"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <IconLayoutList className="size-4" />
              </button>
            </div>
          }
        />
      )}

      {isLoading ? (
        <CardGridSkeleton count={6} columns={view === "grid" ? 3 : 1} />
      ) : variants.length === 0 && !hasFilters ? (
        !courseName && onOpenProfile ? (
          <EmptyState
            icon={<IconInfoCircle className="size-6" />}
            title={emptyMessage || "No courses available"}
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
              emptyMessage ||
              "Add your first question or upload a batch to start building this course's bank."
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
      ) : visibleVariants.length === 0 ? (
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
            view === "grid"
              ? "grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
              : "flex flex-col gap-3",
          )}
          data-tour-id="question-list"
        >
          {visibleVariants.map((entry, index) => (
            <QuestionCard
              key={`${entry.questionId}-${entry.variant.id}`}
              entry={entry}
              questionNumber={index + 1}
              variantNumber={variantNumbers.get(entry.variant.id)}
              onView={onViewVariant}
              onCreateVariant={onCreateVariant}
              onRemoveFromBank={onRemoveFromBank}
              onMoveToBank={onMoveToBank}
              onAddToBank={onAddToBank}
              compact={dense}
            />
          ))}
        </div>
      )}
    </div>
  );
};
