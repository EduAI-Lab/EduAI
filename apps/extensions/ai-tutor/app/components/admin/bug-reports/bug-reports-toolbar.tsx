/**
 * @file Filter bar for the bug-report triage table.
 *
 * Responsibility: status / type / reporter selects, the description search
 *   input, and the "Showing N of M / Clear filters" row. Controlled — all state
 *   lives in `BugReportsTab`; this component only reads props and reports edits.
 */

import { Button, Input } from '@eduai/ui';
import { IconFilter, IconSearch, IconX } from '@tabler/icons-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@eduai/ui';
import type { BugReportType } from '~/lib/types';
import {
  BUG_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  type ReporterFilter,
  type StatusFilter,
  type TypeFilter,
} from '~/components/admin/bug-reports/bug-reports-utils';

export function BugReportsToolbar({
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  reporterFilter,
  onReporterFilterChange,
  searchText,
  onSearchTextChange,
  hasActiveFilters,
  shownCount,
  totalCount,
  onResetFilters,
}: {
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (value: TypeFilter) => void;
  reporterFilter: ReporterFilter;
  onReporterFilterChange: (value: ReporterFilter) => void;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  hasActiveFilters: boolean;
  shownCount: number;
  totalCount: number;
  onResetFilters: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex items-center gap-2">
        <IconFilter className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Filters</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Select
          value={statusFilter}
          onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={typeFilter}
          onValueChange={(v) => onTypeFilterChange(v as TypeFilter)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.entries(BUG_TYPE_LABELS) as [BugReportType, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={reporterFilter}
          onValueChange={(v) => onReporterFilterChange(v as ReporterFilter)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Reporter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reporters</SelectItem>
            <SelectItem value="named">Named</SelectItem>
            <SelectItem value="anonymous">Anonymous</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search description…"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            Showing {shownCount} of {totalCount} reports
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="text-destructive hover:text-destructive"
          >
            <IconX className="h-4 w-4" />
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
