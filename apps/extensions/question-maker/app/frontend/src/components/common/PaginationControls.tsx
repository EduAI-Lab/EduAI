/**
 * Reusable page navigation for QM's server-paginated lists (#1044).
 *
 * Renders a compact "Previous / page N of M / Next" control. Callers own the
 * page state and receive an `onPageChange(nextPage)` callback — this component
 * is presentational and holds no state of its own. Renders nothing when there
 * is only a single page.
 *
 * Mirrors ai-tutor's `PaginationControls` (#1043): button-based (client-side
 * page swaps, not `href` routing) on the shared `@eduai/ui` `Button` and the
 * tabler icons the rest of QM already uses.
 *
 * Related: `services/api.ts` (`Paginated<T>`), `services/courseService.ts`
 * (`getCoursesPage`).
 */
import { Button } from '@eduai/ui';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

export type PaginationControlsProps = {
  /** 1-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total rows across all pages (the envelope's `total`). */
  total: number;
  /** Called with the next 1-based page; guaranteed within [1, pageCount]. */
  onPageChange: (page: number) => void;
  /** Disable the controls while a page fetch is in flight. */
  disabled?: boolean;
};

export function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  disabled = false,
}: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Nothing to page through — render nothing so single-page lists stay clean.
  if (pageCount <= 1) return null;

  const clampedPage = Math.min(Math.max(1, page), pageCount);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < pageCount;

  const rangeStart = (clampedPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(clampedPage * pageSize, total);

  return (
    <nav
      className="flex items-center justify-between gap-4 pt-2"
      aria-label="Pagination"
    >
      <p className="text-sm text-muted-foreground">
        Showing {rangeStart}–{rangeEnd} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !canPrev}
          onClick={() => onPageChange(clampedPage - 1)}
        >
          <IconChevronLeft size={16} aria-hidden="true" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground" aria-current="page">
          Page {clampedPage} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !canNext}
          onClick={() => onPageChange(clampedPage + 1)}
        >
          Next
          <IconChevronRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
