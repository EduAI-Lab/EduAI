/**
 * @file Presentation table for the bug-report triage view.
 *
 * Responsibility: the sortable header row, each report row (status select,
 *   type, description trigger, reporter, role, date, context, page, and the
 *   attachment action buttons), and the empty state. Stateless — all data and
 *   callbacks arrive via props from `BugReportsTab`.
 */

import { hasAttachmentContent } from '@eduai/types';

import { RoleBadge } from '../role-badge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { AdminBugReportRow, BugReportStatus } from './types';
import {
  BUG_TYPE_LABELS,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  STATUS_OPTIONS,
  formatDateTime,
  getContextLabel,
  getPathLabel,
  getReporterLabel,
  getReporterRole,
  type SortDirection,
  type SortKey,
  type ViewerType,
} from './bug-reports-utils';

function StatusSelect({
  reportId,
  status,
  disabled,
  onStatusChange,
}: {
  reportId: string;
  status: BugReportStatus;
  disabled: boolean;
  onStatusChange: (reportId: string, status: BugReportStatus) => void;
}) {
  return (
    <Select
      value={status}
      onValueChange={(value) => onStatusChange(reportId, value as BugReportStatus)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-[140px]" aria-label={`Update status for report ${reportId}`}>
        <SelectValue>
          <Badge variant={STATUS_BADGE_VARIANT[status]} size="sm">
            {STATUS_LABELS[status]}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {STATUS_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortHeader({
  title,
  sortKey,
  activeSortKey,
  direction,
  onToggle,
}: {
  title: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onToggle: (key: SortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium"
      onClick={() => onToggle(sortKey)}
    >
      <span>{title}</span>
      <span aria-hidden="true">{isActive ? (direction === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

export function BugReportsTable({
  reports,
  sortKey,
  sortDirection,
  onToggleSort,
  updatingReportId,
  copiedReportId,
  hasActiveFilters,
  onStatusChange,
  onCopyReport,
  onOpenViewer,
  showSourceColumn = false,
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
  onOpenViewer: (type: Exclude<ViewerType, null>, reportId: string) => void | Promise<void>;
  /** Platform-wide (Core) view only — the extensions pin source via their fetch. */
  showSourceColumn?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1160px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[150px]" />
          <col className="w-[130px]" />
          {showSourceColumn ? <col className="w-[110px]" /> : null}
          <col className="w-[24%]" />
          <col className="w-[14%]" />
          <col className="w-[100px]" />
          <col className="w-[140px]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[180px]" />
        </colgroup>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead>
              <SortHeader
                title="Status"
                sortKey="status"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Type"
                sortKey="bugType"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            {showSourceColumn ? (
              <TableHead>
                <SortHeader
                  title="Source"
                  sortKey="source"
                  activeSortKey={sortKey}
                  direction={sortDirection}
                  onToggle={onToggleSort}
                />
              </TableHead>
            ) : null}
            <TableHead>
              <SortHeader
                title="Description"
                sortKey="description"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Reporter"
                sortKey="reporter"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Role"
                sortKey="role"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Date"
                sortKey="createdAt"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Context"
                sortKey="context"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                title="Page"
                sortKey="page"
                activeSortKey={sortKey}
                direction={sortDirection}
                onToggle={onToggleSort}
              />
            </TableHead>
            <TableHead>Attachments</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showSourceColumn ? 10 : 9} className="whitespace-normal px-4 py-8 text-center text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'No reports match your filters. Try adjusting your search criteria.'
                  : 'No bug reports yet.'}
              </TableCell>
            </TableRow>
          ) : (
            reports.map((report) => (
              <TableRow key={report.id} className="align-top">
                <TableCell className="px-3 py-3">
                  <StatusSelect
                    reportId={report.id}
                    status={report.status}
                    disabled={updatingReportId === report.id}
                    onStatusChange={onStatusChange}
                  />
                </TableCell>
                <TableCell className="overflow-hidden px-3 py-3 text-xs text-muted-foreground">
                  <span className="block truncate">
                    {report.bugType ? BUG_TYPE_LABELS[report.bugType] : '—'}
                  </span>
                </TableCell>
                {showSourceColumn ? (
                  <TableCell className="overflow-hidden px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate">{report.source ?? '—'}</span>
                  </TableCell>
                ) : null}
                <TableCell className="overflow-hidden whitespace-normal px-3 py-3 text-sm">
                  <button
                    type="button"
                    className="line-clamp-3 w-full wrap-break-word text-left text-foreground hover:text-primary-text"
                    title={report.description}
                    onClick={() => onOpenViewer('description', report.id)}
                  >
                    {report.description}
                  </button>
                </TableCell>
                <TableCell className="overflow-hidden px-3 py-3 text-sm text-foreground">
                  {report.isAnonymous ? (
                    <span className="italic text-muted-foreground">Anonymous</span>
                  ) : (
                    <span className="block truncate" title={getReporterLabel(report)}>
                      {getReporterLabel(report)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="overflow-hidden px-3 py-3">
                  {getReporterRole(report) ? (
                    <RoleBadge role={getReporterRole(report)!} />
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="overflow-hidden px-3 py-3 text-sm text-muted-foreground">
                  <span className="block truncate">{formatDateTime(report.createdAt)}</span>
                </TableCell>
                <TableCell className="overflow-hidden whitespace-normal px-3 py-3 text-sm text-muted-foreground">
                  <span className="line-clamp-2 wrap-break-word" title={getContextLabel(report)}>
                    {getContextLabel(report)}
                  </span>
                </TableCell>
                <TableCell className="overflow-hidden px-3 py-3 text-sm text-muted-foreground">
                  <span className="block truncate" title={report.pageUrl ?? ''}>
                    {getPathLabel(report.pageUrl)}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={copiedReportId === report.id ? 'secondary' : 'outline'}
                      onClick={() => onCopyReport(report)}
                    >
                      {copiedReportId === report.id ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenViewer('console', report.id)}
                      disabled={!hasAttachmentContent(report.consoleLogs, report.hasConsoleLogs)}
                    >
                      Console
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenViewer('network', report.id)}
                      disabled={!hasAttachmentContent(report.networkLogs, report.hasNetworkLogs)}
                    >
                      Network
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenViewer('screenshot', report.id)}
                      disabled={!hasAttachmentContent(report.screenshot, report.hasScreenshot)}
                    >
                      Screenshot
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
