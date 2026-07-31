/**
 * Prev/next bar for server-paginated QM lists (#1040 review).
 * Uses @eduai/ui Pagination primitives; hidden when the full set fits on one page.
 */
import {
  Button,
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@eduai/ui';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

export const DEFAULT_LIST_PAGE_SIZE = 50;

type ListPaginationBarProps = {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (nextOffset: number) => void;
  /** Optional noun for the status line, e.g. "questions" / "assessments". */
  itemLabel?: string;
  className?: string;
};

export function ListPaginationBar({
  total,
  limit,
  offset,
  onPageChange,
  itemLabel = 'items',
  className,
}: ListPaginationBarProps) {
  if (total <= 0 || limit <= 0 || total <= limit) return null;

  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ''}`}
      data-testid="list-pagination-bar"
    >
      <p className="text-sm text-muted-foreground">
        Showing{' '}
        <span className="font-medium text-foreground">
          {from}–{to}
        </span>{' '}
        of <span className="font-medium text-foreground">{total}</span> {itemLabel}
      </p>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={!canPrev}
              aria-label="Go to previous page"
            >
              <IconChevronLeft size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onPageChange(offset + limit)}
              disabled={!canNext}
              aria-label="Go to next page"
            >
              <IconChevronRight size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
