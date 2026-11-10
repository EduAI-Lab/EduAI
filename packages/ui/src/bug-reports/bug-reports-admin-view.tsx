/**
 * @file Shared admin triage view for bug reports.
 *
 * All three apps read the same `bug_reports` table through the same Core
 * endpoint — the QM and AI Tutor backends are pure HTTP proxies that differ
 * only by a `source` query param — yet each had its own implementation of the
 * same sortable table, filter bar, and status control, down to identical
 * copy ("Showing N of M reports") and an identical `'▲' : '▼') : '↕'` glyph.
 * This is that view, with the fetch/update injected.
 *
 * Anonymity masking is server-side (`bugReportMappers`); this only renders.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { hasAttachmentContent } from "@eduai/types";
import { IconAlertCircle } from "@tabler/icons-react";

import { Alert, AlertDescription } from "../ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { BugReportsCompactTable } from "./bug-reports-compact-table";
import { BugReportsTable } from "./bug-reports-table";
import { BugReportsToolbar } from "./bug-reports-toolbar";
import { ReportDetailPanel } from "./report-detail-panel";
import { ReportViewerDialog } from "./report-viewers";
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
} from "./bug-reports-utils";
import type {
  AdminBugReportRow,
  BugReportStatus,
  ReporterNoteDelivery,
  ReporterNoteInput,
} from "./types";

export interface BugReportsAdminViewProps {
  reports: AdminBugReportRow[];
  /**
   * Persists a status change and resolves with the updated row. Each app points
   * this at its own client — Core hits the route directly, the extensions go
   * through their proxy.
   */
  onUpdateStatus: (
    reportId: string,
    status: BugReportStatus,
  ) => Promise<Partial<AdminBugReportRow> | void>;
  /**
   * Fetches one report's full payload. The list endpoint omits the console /
   * network / screenshot bodies (#979) and sends only `has*` flags, so the
   * viewers and the copy dossier pull the blobs on demand. Omit it when the
   * owner's list already carries the bodies — the view then renders what it has.
   */
  onLoadDetail?: (reportId: string) => Promise<Partial<AdminBugReportRow>>;
  /**
   * Saves the admin's status note on a report and emails it to the reporter,
   * resolving with how delivery went and the updated note fields. The panel
   * layout shows a "Reply to reporter" section only when this is set (Core).
   */
  onSaveReporterNote?: (
    reportId: string,
    note: ReporterNoteInput,
  ) => Promise<{ delivery: ReporterNoteDelivery } & Partial<AdminBugReportRow>>;
  title?: string;
  description?: string;
  /**
   * Leaves the card's title and description out, for a page that already
   * shows them in its own page header (Core's admin pages).
   */
  hideHeader?: boolean;
  /** Only the platform-wide (Core) view shows which app a report came from. */
  showSourceColumn?: boolean;
  /**
   * Non-error banner above the toolbar. Core uses it to say when the list is
   * capped at the server's page limit, which used to truncate silently.
   */
  notice?: React.ReactNode;
  /** Replaces the table with a loading line while the owner fetches. */
  isLoading?: boolean;
  /**
   * "panel" (Core): a compact table — Status, Type, Description, Reporter,
   * Date, "…" — whose rows open the whole report in a side panel, and a
   * single-row filter bar. "table" (default) keeps every detail as a column.
   */
  layout?: "table" | "panel";
  /**
   * The report open in the panel, for an owner that keeps it in the URL
   * (`?report=<id>`) so it can be linked and survives a reload. Leave both
   * unset to let the view track it itself.
   */
  openReportId?: string | null;
  onOpenReportChange?: (reportId: string | null) => void;
  className?: string;
}

export function BugReportsAdminView({
  reports: initialReports,
  onUpdateStatus,
  onLoadDetail,
  onSaveReporterNote,
  title = "Bug reports",
  description = "Filter and update status for incoming reports.",
  hideHeader = false,
  showSourceColumn = false,
  notice,
  isLoading = false,
  layout = "table",
  openReportId,
  onOpenReportChange,
  className,
}: BugReportsAdminViewProps) {
  const [ownOpenReportId, setOwnOpenReportId] = useState<string | null>(null);
  const panelReportId = openReportId !== undefined ? openReportId : ownOpenReportId;
  const setPanelReportId = (reportId: string | null) => {
    if (openReportId === undefined) setOwnOpenReportId(reportId);
    onOpenReportChange?.(reportId);
  };
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [reports, setReports] = useState<AdminBugReportRow[]>(initialReports);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerType, setViewerType] = useState<ViewerType>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [reporterFilter, setReporterFilter] = useState<ReporterFilter>("all");
  const [searchText, setSearchText] = useState("");

  // Keep in sync when the owner refetches (Core's loader revalidates).
  const [lastInitial, setLastInitial] = useState(initialReports);
  if (initialReports !== lastInitial) {
    setLastInitial(initialReports);
    setReports(initialReports);
  }

  const filteredSortedReports = useMemo(() => {
    const filtered = reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (typeFilter !== "all" && report.bugType !== typeFilter) return false;
      if (reporterFilter === "named" && report.isAnonymous) return false;
      if (reporterFilter === "anonymous" && !report.isAnonymous) return false;
      if (searchText && !report.description.toLowerCase().includes(searchText.toLowerCase()))
        return false;
      return true;
    });
    return sortReports(filtered, sortKey, sortDirection);
  }, [reports, statusFilter, typeFilter, reporterFilter, searchText, sortKey, sortDirection]);

  const hasActiveFilters =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    reporterFilter !== "all" ||
    searchText.length > 0;

  const resetFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setReporterFilter("all");
    setSearchText("");
  };

  const selectedReport =
    selectedReportId === null
      ? null
      : (reports.find((report) => report.id === selectedReportId) ?? null);

  const toggleSort = (nextSortKey: SortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    // Date defaults to descending (newest first); everything else ascending.
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "createdAt" ? "desc" : "asc");
  };

  /**
   * Pulls the blobs the list omitted and folds them into the row, so the
   * viewer and any later copy read from state instead of refetching.
   */
  const loadReportDetail = async (reportId: string): Promise<AdminBugReportRow | null> => {
    if (!onLoadDetail) return null;
    const detailed = await onLoadDetail(reportId);
    let merged: AdminBugReportRow | null = null;
    setReports((current) =>
      current.map((report) => {
        if (report.id !== reportId) return report;
        merged = {
          ...report,
          ...detailed,
          hasConsoleLogs: hasAttachmentContent(detailed.consoleLogs, detailed.hasConsoleLogs),
          hasNetworkLogs: hasAttachmentContent(detailed.networkLogs, detailed.hasNetworkLogs),
          hasScreenshot: hasAttachmentContent(detailed.screenshot, detailed.hasScreenshot),
        };
        return merged;
      }),
    );
    return merged;
  };

  // Fetch once per report, and only when it actually has diagnostics to fetch.
  const needsDetailFor = (report: AdminBugReportRow | undefined) =>
    onLoadDetail != null &&
    report != null &&
    report.consoleLogs == null &&
    report.networkLogs == null &&
    report.screenshot == null &&
    (hasAttachmentContent(report.consoleLogs, report.hasConsoleLogs) ||
      hasAttachmentContent(report.networkLogs, report.hasNetworkLogs) ||
      hasAttachmentContent(report.screenshot, report.hasScreenshot));

  const panelReport =
    panelReportId === null ? null : (reports.find((report) => report.id === panelReportId) ?? null);

  // The panel shows the screenshot inline, so it pulls the report's bodies as
  // soon as it opens — once per report; a failure leaves the buttons to retry.
  const detailRequested = useRef<string | null>(null);
  useEffect(() => {
    if (layout !== "panel" || !panelReport || detailRequested.current === panelReport.id) return;
    if (!needsDetailFor(panelReport)) return;
    detailRequested.current = panelReport.id;
    setLoadingDetailId(panelReport.id);
    loadReportDetail(panelReport.id)
      .catch(() => setError("Could not load bug report details. Please try again."))
      .finally(() =>
        setLoadingDetailId((current) => (current === panelReport.id ? null : current)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, panelReport?.id]);

  const openViewer = async (type: Exclude<ViewerType, null>, reportId: string) => {
    setError(null);
    const report = reports.find((candidate) => candidate.id === reportId);
    const needsDetail = needsDetailFor(report);

    if (!needsDetail) {
      setSelectedReportId(reportId);
      setViewerType(type);
      return;
    }

    try {
      // Open only after detail resolves so list-row null blobs don't flash empty viewers.
      await loadReportDetail(reportId);
      setSelectedReportId(reportId);
      setViewerType(type);
    } catch {
      setError("Could not load bug report details. Please try again.");
      setViewerType(null);
      setSelectedReportId(null);
    }
  };

  const closeViewer = () => {
    setViewerType(null);
    setSelectedReportId(null);
  };

  const onStatusChange = async (reportId: string, status: BugReportStatus) => {
    setError(null);
    setUpdatingReportId(reportId);
    try {
      const updated = await onUpdateStatus(reportId, status);
      setReports((current) =>
        current.map((report) =>
          report.id === reportId ? { ...report, status, ...updated } : report,
        ),
      );
    } catch {
      setError("Could not update bug report status. Please try again.");
    } finally {
      setUpdatingReportId(null);
    }
  };

  const saveReporterNote = onSaveReporterNote
    ? async (reportId: string, note: ReporterNoteInput) => {
        const { delivery, ...updated } = await onSaveReporterNote(reportId, note);
        setReports((current) =>
          current.map((report) => (report.id === reportId ? { ...report, ...updated } : report)),
        );
        return { delivery };
      }
    : undefined;

  const onCopyReport = async (report: AdminBugReportRow) => {
    setError(null);
    try {
      const alreadyHasBlobs =
        report.consoleLogs != null || report.networkLogs != null || report.screenshot != null;
      const hasAnyAttachment =
        hasAttachmentContent(report.consoleLogs, report.hasConsoleLogs) ||
        hasAttachmentContent(report.networkLogs, report.hasNetworkLogs) ||
        hasAttachmentContent(report.screenshot, report.hasScreenshot);
      // Skip the detail fetch when the report has no diagnostics at all.
      const detailed =
        alreadyHasBlobs || !hasAnyAttachment
          ? report
          : ((await loadReportDetail(report.id)) ?? report);
      await copyTextToClipboard(buildBugReportCopyText(detailed));
      setCopiedReportId(report.id);
      window.setTimeout(() => {
        setCopiedReportId((current) => (current === report.id ? null : current));
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      setError("Could not copy bug report details. Please try again.");
      setCopiedReportId((current) => (current === report.id ? null : current));
    }
  };

  return (
    <Card className={className}>
      {!hideHeader && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {notice ? (
          <Alert>
            <IconAlertCircle />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <BugReportsToolbar
          compact={layout === "panel"}
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

        {isLoading ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            Loading bug reports…
          </p>
        ) : layout === "panel" ? (
          <BugReportsCompactTable
            reports={filteredSortedReports}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onToggleSort={toggleSort}
            updatingReportId={updatingReportId}
            copiedReportId={copiedReportId}
            hasActiveFilters={hasActiveFilters}
            onStatusChange={onStatusChange}
            onCopyReport={onCopyReport}
            onOpenReport={setPanelReportId}
          />
        ) : (
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
            showSourceColumn={showSourceColumn}
          />
        )}
      </CardContent>

      {layout === "panel" && (
        <ReportDetailPanel
          report={panelReport}
          open={panelReport !== null}
          onOpenChange={(open) => {
            if (!open) setPanelReportId(null);
          }}
          loadingDetail={loadingDetailId !== null && loadingDetailId === panelReportId}
          updatingReportId={updatingReportId}
          copiedReportId={copiedReportId}
          onStatusChange={onStatusChange}
          onCopyReport={onCopyReport}
          onOpenViewer={openViewer}
          onSaveReporterNote={saveReporterNote}
        />
      )}
      <ReportViewerDialog viewerType={viewerType} report={selectedReport} onClose={closeViewer} />
    </Card>
  );
}
