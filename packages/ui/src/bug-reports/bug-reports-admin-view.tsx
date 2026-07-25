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
import { useMemo, useState } from "react"
import type * as React from "react"

import { IconAlertCircle } from "@tabler/icons-react"

import { Alert, AlertDescription } from "../ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { BugReportsTable } from "./bug-reports-table"
import { BugReportsToolbar } from "./bug-reports-toolbar"
import { ReportViewerDialog } from "./report-viewers"
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
} from "./bug-reports-utils"
import type { AdminBugReportRow, BugReportStatus } from "./types"

export interface BugReportsAdminViewProps {
  reports: AdminBugReportRow[]
  /**
   * Persists a status change and resolves with the updated row. Each app points
   * this at its own client — Core hits the route directly, the extensions go
   * through their proxy.
   */
  onUpdateStatus: (
    reportId: string,
    status: BugReportStatus,
  ) => Promise<Partial<AdminBugReportRow> | void>
  title?: string
  description?: string
  /** Only the platform-wide (Core) view shows which app a report came from. */
  showSourceColumn?: boolean
  /**
   * Non-error banner above the toolbar. Core uses it to say when the list is
   * capped at the server's page limit, which used to truncate silently.
   */
  notice?: React.ReactNode
  /** Replaces the table with a loading line while the owner fetches. */
  isLoading?: boolean
  className?: string
}

export function BugReportsAdminView({
  reports: initialReports,
  onUpdateStatus,
  title = "Bug reports",
  description = "Filter and update status for incoming reports.",
  showSourceColumn = false,
  notice,
  isLoading = false,
  className,
}: BugReportsAdminViewProps) {
  const [reports, setReports] = useState<AdminBugReportRow[]>(initialReports)
  const [sortKey, setSortKey] = useState<SortKey>("createdAt")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null)
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewerType, setViewerType] = useState<ViewerType>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [reporterFilter, setReporterFilter] = useState<ReporterFilter>("all")
  const [searchText, setSearchText] = useState("")

  // Keep in sync when the owner refetches (Core's loader revalidates).
  const [lastInitial, setLastInitial] = useState(initialReports)
  if (initialReports !== lastInitial) {
    setLastInitial(initialReports)
    setReports(initialReports)
  }

  const filteredSortedReports = useMemo(() => {
    const filtered = reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false
      if (typeFilter !== "all" && report.bugType !== typeFilter) return false
      if (reporterFilter === "named" && report.isAnonymous) return false
      if (reporterFilter === "anonymous" && !report.isAnonymous) return false
      if (searchText && !report.description.toLowerCase().includes(searchText.toLowerCase()))
        return false
      return true
    })
    return sortReports(filtered, sortKey, sortDirection)
  }, [reports, statusFilter, typeFilter, reporterFilter, searchText, sortKey, sortDirection])

  const hasActiveFilters =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    reporterFilter !== "all" ||
    searchText.length > 0

  const resetFilters = () => {
    setStatusFilter("all")
    setTypeFilter("all")
    setReporterFilter("all")
    setSearchText("")
  }

  const selectedReport =
    selectedReportId === null
      ? null
      : (reports.find((report) => report.id === selectedReportId) ?? null)

  const toggleSort = (nextSortKey: SortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    // Date defaults to descending (newest first); everything else ascending.
    setSortKey(nextSortKey)
    setSortDirection(nextSortKey === "createdAt" ? "desc" : "asc")
  }

  const openViewer = (type: Exclude<ViewerType, null>, reportId: string) => {
    setSelectedReportId(reportId)
    setViewerType(type)
  }

  const closeViewer = () => {
    setViewerType(null)
    setSelectedReportId(null)
  }

  const onStatusChange = async (reportId: string, status: BugReportStatus) => {
    setError(null)
    setUpdatingReportId(reportId)
    try {
      const updated = await onUpdateStatus(reportId, status)
      setReports((current) =>
        current.map((report) =>
          report.id === reportId ? { ...report, status, ...(updated ?? {}) } : report,
        ),
      )
    } catch {
      setError("Could not update bug report status. Please try again.")
    } finally {
      setUpdatingReportId(null)
    }
  }

  const onCopyReport = async (report: AdminBugReportRow) => {
    setError(null)
    try {
      await copyTextToClipboard(buildBugReportCopyText(report))
      setCopiedReportId(report.id)
      window.setTimeout(() => {
        setCopiedReportId((current) => (current === report.id ? null : current))
      }, COPY_FEEDBACK_DURATION_MS)
    } catch {
      setError("Could not copy bug report details. Please try again.")
      setCopiedReportId((current) => (current === report.id ? null : current))
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
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

      <ReportViewerDialog viewerType={viewerType} report={selectedReport} onClose={closeViewer} />
    </Card>
  )
}
