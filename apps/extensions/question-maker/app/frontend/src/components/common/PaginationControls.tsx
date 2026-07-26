/**
 * Reusable page navigation for QM's server-paginated lists (#1044).
 *
 * Renders a compact "Previous / page N of M / Next" control. Callers own the
 * page state and receive an `onPageChange(nextPage)` callback — this component
 * is presentational and holds no state of its own. Renders nothing when there
 * is only a single page.
 *
 * Built on `@eduai/ui`'s shared `Pagination`/`PaginationContent`/`PaginationItem`
 * shell so QM's pager doesn't drift from the other apps'. The prev/next controls
 * stay `Button`s rather than the package's `PaginationPrevious`/`PaginationNext`:
 * those render bare `<a>` elements, which aren't focusable without an `href` and
 * have no disabled state — wrong for a callback-driven pager that must disable
 * at the ends. Mirrors ai-tutor's `PaginationControls` (#1043).
 *
 * Related: `services/api.ts` (`Paginated<T>`), `services/courseService.ts`
 * (`getCoursesPage`).
 */
import { useEffect } from 'react';
import { Button, Pagination, PaginationContent, PaginationItem } from '@eduai/ui';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

export type PaginationControlsProps = {
  /** 1-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total rows across all pages (the envelope's `total`). */
  total: number;
  /**
   * Called with the next 1-based page; guaranteed within [1, pageCount].
   *
   * Also called on mount/update when `page` is out of range, so the parent's
   * page state and the rows it has loaded stay in step — see the clamp effect.
   */
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
  const clampedPage = Math.min(Math.max(1, page), pageCount);

  // Displaying a clamped page while the parent still holds the out-of-range one
  // desyncs the pager from the loaded rows: the parent asked for page 5, the
  // list shrank to 2 pages, and it renders "page 2 of 2" against page-5 data
  // (usually empty) with no way back. Push the clamp up so the parent refetches.
  // Guarded by the inequality, so a fresh `onPageChange` identity each render
  // can't loop.
  useEffect(() => {
    if (clampedPage !== page) onPageChange(clampedPage);
  }, [clampedPage, page, onPageChange]);

  // Nothing to page through — render nothing so single-page lists stay clean.
  // Placed after the effect so a collapse to one page still notifies: otherwise
  // a parent sitting on page 3 would be stranded with the pager unmounted.
  if (pageCount <= 1) return null;

  const canPrev = clampedPage > 1;
  const canNext = clampedPage < pageCount;

  const rangeStart = (clampedPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(clampedPage * pageSize, total);

  return (
    <Pagination className="mx-0 w-full items-center justify-between gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Showing {rangeStart}–{rangeEnd} of {total}
      </p>
      <PaginationContent>
        <PaginationItem>
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
        </PaginationItem>
        <PaginationItem className="px-2 text-sm text-muted-foreground">
          Page {clampedPage} of {pageCount}
        </PaginationItem>
        <PaginationItem>
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
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
