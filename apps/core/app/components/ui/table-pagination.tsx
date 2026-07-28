import { useId } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";

import {
  Button,
  Label,
  Pagination,
  PaginationContent,
  PaginationItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@eduai/ui";

import type { PaginationState } from "~/hooks/api/pagination";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export type TablePaginationProps = {
  pagination: PaginationState;
  onPaginationChange: (next: PaginationState) => void;
  /** Server-reported row count for the current filters. */
  total: number;
};

/**
 * Pager for the server-paginated admin lists that are not TanStack tables
 * (#1041). TanStack tables drive the equivalent controls off `table.*` with
 * `manualPagination` instead.
 */
export function TablePagination({ pagination, onPaginationChange, total }: TablePaginationProps) {
  const id = useId();
  const { pageIndex, pageSize } = pagination;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const canPrevious = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  const goTo = (nextIndex: number) =>
    onPaginationChange({ pageIndex: Math.min(Math.max(nextIndex, 0), pageCount - 1), pageSize });

  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-8">
      <div className="flex items-center gap-3">
        <Label htmlFor={id} className="max-sm:sr-only">
          Rows per page
        </Label>
        <Select
          value={String(pageSize)}
          onValueChange={(value) =>
            // Changing the page size invalidates the offset, so return to page 1.
            onPaginationChange({ pageIndex: 0, pageSize: Number(value) })
          }
        >
          <SelectTrigger id={id} className="w-fit whitespace-nowrap">
            <SelectValue placeholder="Select number of results" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-muted-foreground flex grow justify-end text-sm whitespace-nowrap">
        <p aria-live="polite">
          <span className="text-foreground">
            {firstRow}-{lastRow}
          </span>{" "}
          of <span className="text-foreground">{total}</span>
        </p>
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Button
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => goTo(0)}
              disabled={!canPrevious}
              aria-label="Go to first page"
            >
              <IconChevronsLeft size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => goTo(pageIndex - 1)}
              disabled={!canPrevious}
              aria-label="Go to previous page"
            >
              <IconChevronLeft size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => goTo(pageIndex + 1)}
              disabled={!canNext}
              aria-label="Go to next page"
            >
              <IconChevronRight size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              size="icon"
              variant="outline"
              className="disabled:pointer-events-none disabled:opacity-50"
              onClick={() => goTo(pageCount - 1)}
              disabled={!canNext}
              aria-label="Go to last page"
            >
              <IconChevronsRight size={16} aria-hidden="true" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
