/**
 * @file Admin triage table for incoming bug reports.
 *
 * Responsibility: Sortable table view of all reports plus modal viewers for
 *   the description, captured console logs, captured network logs, and
 *   screenshot. Lets admins move each report through status (unhandled →
 *   in progress → resolved) and copy a self-contained text dossier.
 * Used by: `app/routes/admin.tsx` as one tab of the admin dashboard.
 * Composition: this file owns state + data fetching and composes three sibling
 *   pieces from `./bug-reports/` — the filter `BugReportsToolbar`, the
 *   presentation `BugReportsTable`, and the modal `ReportViewerDialog`. Shared
 *   types, constants, and pure helpers live in `./bug-reports/bug-reports-utils`.
 * Gotchas:
 *   - **Anonymous reports**: when a reporter checks "submit anonymously",
 *     the server in `server/src/utils/bugReportMappers.js` strips identifying
 *     fields. This component only RENDERS; the masking is server-side. The
 *     `getReporterLabel` helper still falls through to the userId so admins
 *     can correlate without seeing the name/email.
 *   - **List vs detail (#979)**: list rows omit console/network/screenshot
 *     bodies and only carry `has*` flags. Opening a viewer or copying a dossier
 *     fetches `GET /api/admin/bug-reports/:id` for the full payloads.
 *   - **Sort**: `createdAt` sorts as Date timestamps; everything else uses
 *     `String(...).localeCompare` (case-insensitive via locale). Null/undefined
 *     fields fall through to `''` to keep them at the start of asc / end of desc.
 *   - **Console filter**: levels are normalized to lowercase before comparison
 *     so a stored "WARN" matches the "warn" filter chip.
 *   - **Network viewer**: the entries dropdown switches the inner tab back to
 *     "meta" on change so a heavy response body from the previous request
 *     doesn't flash before the user can navigate.
 *   - The clipboard helper falls back to a hidden textarea + execCommand for
 *     contexts where `navigator.clipboard` is unavailable (older Safari,
 *     non-secure contexts).
 *   - The copy dossier respects anonymity: identifying fields are omitted
 *     from the raw appendix when `report.isAnonymous` is true.
 * Related: `server/src/routes/admin.js` (PATCH bug-report endpoint),
 *   `server/src/utils/bugReportMappers.js` (anonymity masking),
 *   `@eduai/ui BugReportDialog` (capture-side counterpart)
 */

import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@eduai/ui';
import { IconAlertCircle } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@eduai/ui';
import api from '~/lib/api';
import type { AdminBugReportRow, BugReportStatus } from '~/lib/types';
import { BugReportsTable } from '~/components/admin/bug-reports/bug-reports-table';
import { BugReportsToolbar } from '~/components/admin/bug-reports/bug-reports-toolbar';
import { ReportViewerDialog } from '~/components/admin/bug-reports/report-viewers';
import {
  buildBugReportCopyText,
  copyTextToClipboard,
  sortReports,
  COPY_FEEDBACK_DURATION_MS,
  type ReporterFilter,
  type SortDirection,
  type SortKey,
  type StatusFilter,
  type TypeFilter,
  type ViewerType,
} from '~/components/admin/bug-reports/bug-reports-utils';

/**
 * Top-level table component. `initialReports` is provided by the admin route
 * loader; subsequent mutations (status PATCH) update the local list optimistically.
 */
export default function BugReportsTab({ initialReports }: { initialReports: AdminBugReportRow[] }) {
  const [reports, setReports] = useState<AdminBugReportRow[]>(initialReports);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerType, setViewerType] = useState<ViewerType>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<AdminBugReportRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [reporterFilter, setReporterFilter] = useState<ReporterFilter>('all');
  const [searchText, setSearchText] = useState('');

  const filteredSortedReports = useMemo(() => {
    const filtered = reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (typeFilter !== 'all' && report.bugType !== typeFilter) return false;
      if (reporterFilter === 'named' && report.isAnonymous) return false;
      if (reporterFilter === 'anonymous' && !report.isAnonymous) return false;
      if (searchText && !report.description.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
    return sortReports(filtered, sortKey, sortDirection);
  }, [reports, statusFilter, typeFilter, reporterFilter, searchText, sortKey, sortDirection]);

  const hasActiveFilters =
    statusFilter !== 'all' || typeFilter !== 'all' || reporterFilter !== 'all' || searchText.length > 0;

  const resetFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setReporterFilter('all');
    setSearchText('');
  };

  const selectedReport =
    detailReport && detailReport.id === selectedReportId
      ? detailReport
      : selectedReportId === null
        ? null
        : (reports.find((report) => report.id === selectedReportId) ?? null);

  /** List rows omit diagnostic blobs (#979); load full detail on demand. */
  const loadReportDetail = async (reportId: string): Promise<AdminBugReportRow> => {
    const detailed = await api.getAdminBugReport(reportId);
    setReports((current) =>
      current.map((report) =>
        report.id === reportId
          ? {
              ...report,
              ...detailed,
              hasConsoleLogs: detailed.hasConsoleLogs ?? Boolean(detailed.consoleLogs),
              hasNetworkLogs: detailed.hasNetworkLogs ?? Boolean(detailed.networkLogs),
              hasScreenshot: detailed.hasScreenshot ?? Boolean(detailed.screenshot),
            }
          : report,
      ),
    );
    setDetailReport(detailed);
    return detailed;
  };

  const toggleSort = (nextSortKey: SortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    // Date defaults to descending (newest first); everything else to ascending (A-Z).
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === 'createdAt' ? 'desc' : 'asc');
  };

  const openViewer = async (type: Exclude<ViewerType, null>, reportId: string) => {
    setError(null);
    setSelectedReportId(reportId);
    setViewerType(type);
    try {
      await loadReportDetail(reportId);
    } catch {
      setError('Could not load bug report details. Please try again.');
      setViewerType(null);
      setSelectedReportId(null);
      setDetailReport(null);
    }
  };

  const closeViewer = () => {
    setViewerType(null);
    setSelectedReportId(null);
    setDetailReport(null);
  };

  const onStatusChange = async (reportId: string, status: BugReportStatus) => {
    setError(null);
    setUpdatingReportId(reportId);
    try {
      const updated = await api.updateAdminBugReportStatus(reportId, { status });
      setReports((current) =>
        current.map((report) => (report.id === reportId ? { ...report, ...updated } : report)),
      );
    } catch {
      setError('Could not update bug report status. Please try again.');
    } finally {
      setUpdatingReportId(null);
    }
  };

  const onCopyReport = async (report: AdminBugReportRow) => {
    setError(null);
    try {
      // Copy dossier needs diagnostic blobs; list rows may only have has* flags.
      const detailed =
        report.consoleLogs != null || report.networkLogs != null || report.screenshot != null
          ? report
          : await loadReportDetail(report.id);
      await copyTextToClipboard(buildBugReportCopyText(detailed));
      setCopiedReportId(report.id);
      window.setTimeout(() => {
        setCopiedReportId((current) => (current === report.id ? null : current));
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      setError('Could not copy bug report details. Please try again.');
      setCopiedReportId((current) => (current === report.id ? null : current));
    }
  };

  return (
    <Card className="animate-fade-up delay-150">
      <CardHeader>
        <CardTitle>Bug reports</CardTitle>
        <CardDescription>
          Review AI Tutor bug reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Filter bar */}
        <BugReportsToolbar
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          reporterFilter={reporterFilter}
          onReporterFilterChange={setReporterFilter}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          hasActiveFilters={hasActiveFilters}
          shownCount={filteredSortedReports.length}
          totalCount={reports.length}
          onResetFilters={resetFilters}
        />

        <BugReportsTable
          reports={filteredSortedReports}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onToggleSort={toggleSort}
          updatingReportId={updatingReportId}
          copiedReportId={copiedReportId}
          hasActiveFilters={hasActiveFilters}
          onStatusChange={onStatusChange}
          onCopyReport={onCopyReport}
          onOpenViewer={openViewer}
        />
      </CardContent>

      <ReportViewerDialog
        viewerType={viewerType}
        report={selectedReport}
        onClose={closeViewer}
      />
    </Card>
  );
}
