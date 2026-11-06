/**
 * @file The compact triage table (Core): Status, Type, Description, Reporter,
 *   Date and a "…" menu. Everything the full table shows per row lives in the
 *   report's side panel instead; a click or Enter on a row opens it.
 */

import type * as React from "react";
import { IconDots } from "@tabler/icons-react";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { SortHeader, StatusSelect } from "./bug-reports-table";
import type { AdminBugReportRow, BugReportStatus } from "./types";
import {
  BUG_TYPE_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  formatDateTime,
  formatShortDate,
  getReporterName,
  type SortDirection,
  type SortKey,
} from "./bug-reports-utils";

export function BugReportsCompactTable({
  reports,
  sortKey,
  sortDirection,
  onToggleSort,
  updatingReportId,
  copiedReportId,
  hasActiveFilters,
  onStatusChange,
  onCopyReport,
  onOpenReport,
}: {
  reports: AdminBugReportRow[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onToggleSort: (key: SortKey) => void;
  updatingReportId: string | null;
  copiedReportId: string | null;
  hasActiveFilters: boolean;
  onStatusChange: (reportId: string, status: BugReportStatus) => void;
  onCopyReport: (report: AdminBugReportRow) => void;
  onOpenReport: (reportId: string) => void;
}) {
  const sortHeader = (title: string, key: SortKey) => (
    <SortHeader
      title={title}
      sortKey={key}
      activeSortKey={sortKey}
      direction={sortDirection}
      onToggle={onToggleSort}
    />
  );

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[680px] table-fixed">
        <colgroup>
          <col className="w-[160px]" />
          <col className="w-[130px]" />
          <col />
          <col className="w-[160px]" />
          <col className="w-[90px]" />
          <col className="w-[64px]" />
        </colgroup>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead>{sortHeader("Status", "status")}</TableHead>
            <TableHead>{sortHeader("Type", "bugType")}</TableHead>
            <TableHead>{sortHeader("Description", "description")}</TableHead>
            <TableHead>{sortHeader("Reporter", "reporter")}</TableHead>
            <TableHead>{sortHeader("Date", "createdAt")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="whitespace-normal px-4 py-8 text-center text-sm text-muted-foreground"
              >
                {hasActiveFilters
                  ? "No reports match your filters. Try adjusting your search criteria."
                  : "No bug reports yet."}
              </TableCell>
            </TableRow>
          ) : (
            reports.map((report) => {
              const open = () => onOpenReport(report.id);
              const onKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                // Only the row itself: Enter on the "…" button inside is that button's.
                if (event.key === "Enter" && event.target === event.currentTarget) {
                  event.preventDefault();
                  open();
                }
              };
              return (
                <TableRow
                  key={report.id}
                  tabIndex={0}
                  aria-label={`Open report: ${report.description}`}
                  onClick={open}
                  onKeyDown={onKeyDown}
                  className="cursor-pointer align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {/* Status changes in place; like the "…" menu, its events (the
                      options render in a portal but still bubble here) stay
                      out of the row so they never open the panel. */}
                  <TableCell
                    className="px-3 py-2"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <StatusSelect
                      reportId={report.id}
                      status={report.status}
                      disabled={updatingReportId === report.id}
                      onStatusChange={onStatusChange}
                    />
                  </TableCell>
                  <TableCell className="overflow-hidden px-3 py-3 text-sm text-muted-foreground">
                    <span className="block truncate">
                      {report.bugType ? BUG_TYPE_LABELS[report.bugType] : "—"}
                    </span>
                  </TableCell>
                  <TableCell className="overflow-hidden whitespace-normal px-3 py-3 text-sm">
                    <span className="line-clamp-2 wrap-break-word text-foreground">
                      {report.description}
                    </span>
                  </TableCell>
                  <TableCell className="overflow-hidden px-3 py-3 text-sm">
                    {report.isAnonymous ? (
                      <span className="italic text-muted-foreground">Anonymous</span>
                    ) : (
                      <span className="block truncate">{getReporterName(report)}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-muted-foreground">
                    <span title={formatDateTime(report.createdAt)}>
                      {formatShortDate(report.createdAt)}
                    </span>
                  </TableCell>
                  {/* The menu's clicks and keys stay inside it, so they never open the panel. */}
                  <TableCell
                    className="px-3 py-2 text-right"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          aria-label={`Actions for report ${report.id}`}
                        >
                          <IconDots className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Status</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={report.status}
                          onValueChange={(value) =>
                            onStatusChange(report.id, value as BugReportStatus)
                          }
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <DropdownMenuRadioItem
                              key={option}
                              value={option}
                              disabled={updatingReportId === report.id}
                            >
                              {STATUS_LABELS[option]}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onCopyReport(report)}>
                          {copiedReportId === report.id ? "Copied!" : "Copy"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
