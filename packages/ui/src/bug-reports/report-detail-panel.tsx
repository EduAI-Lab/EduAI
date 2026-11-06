/**
 * @file One bug report in a side panel (Core's compact view): the full
 *   description, its status (changeable here), every detail the full table
 *   shows as columns, and the attachments, with the screenshot inline.
 *   Console and Network open the existing viewers; closing (X, Escape, an
 *   outside click) is the Sheet's own behaviour.
 */

import type * as React from "react";
import { hasAttachmentContent } from "@eduai/types";

import { RoleBadge } from "../role-badge";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { StatusSelect } from "./bug-reports-table";
import { ScreenshotViewer } from "./report-viewers";
import type { AdminBugReportRow, BugReportStatus } from "./types";
import {
  BUG_TYPE_LABELS,
  formatDateTime,
  getContextLabel,
  getReporterEmail,
  getReporterName,
  getReporterRole,
  type ViewerType,
} from "./bug-reports-utils";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-break-word">{children}</dd>
    </div>
  );
}

export function ReportDetailPanel({
  report,
  open,
  onOpenChange,
  loadingDetail,
  updatingReportId,
  copiedReportId,
  onStatusChange,
  onCopyReport,
  onOpenViewer,
}: {
  report: AdminBugReportRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The attachments' bodies are still loading (the list omits them). */
  loadingDetail: boolean;
  updatingReportId: string | null;
  copiedReportId: string | null;
  onStatusChange: (reportId: string, status: BugReportStatus) => void;
  onCopyReport: (report: AdminBugReportRow) => void;
  onOpenViewer: (type: Exclude<ViewerType, null>, reportId: string) => void | Promise<void>;
}) {
  const role = report ? getReporterRole(report) : null;
  const email = report ? getReporterEmail(report) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Report Description</SheetTitle>
          <SheetDescription>
            {report ? `${getReporterName(report)} • ${formatDateTime(report.createdAt)}` : ""}
          </SheetDescription>
        </SheetHeader>

        {report ? (
          <div className="flex flex-col gap-6 p-4">
            <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm whitespace-pre-wrap wrap-break-word">
              {report.description}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Status</span>
              <StatusSelect
                reportId={report.id}
                status={report.status}
                disabled={updatingReportId === report.id}
                onStatusChange={onStatusChange}
              />
            </div>

            <dl className="flex flex-col gap-3">
              <Detail label="Type">{report.bugType ? BUG_TYPE_LABELS[report.bugType] : "—"}</Detail>
              <Detail label="Source">{report.source ?? "—"}</Detail>
              <Detail label="Reporter">
                <div className="flex flex-col items-start gap-1">
                  <span className={report.isAnonymous ? "italic text-muted-foreground" : ""}>
                    {getReporterName(report)}
                  </span>
                  {email && <span className="text-muted-foreground">{email}</span>}
                  {role && <RoleBadge role={role} />}
                </div>
              </Detail>
              <Detail label="Date">{formatDateTime(report.createdAt)}</Detail>
              <Detail label="Context">{getContextLabel(report)}</Detail>
              <Detail label="Page">{report.pageUrl ?? "-"}</Detail>
            </dl>

            <section aria-label="Attachments" className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={copiedReportId === report.id ? "secondary" : "outline"}
                  onClick={() => onCopyReport(report)}
                >
                  {copiedReportId === report.id ? "Copied!" : "Copy"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenViewer("console", report.id)}
                  disabled={!hasAttachmentContent(report.consoleLogs, report.hasConsoleLogs)}
                >
                  Console
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenViewer("network", report.id)}
                  disabled={!hasAttachmentContent(report.networkLogs, report.hasNetworkLogs)}
                >
                  Network
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenViewer("screenshot", report.id)}
                  disabled={!hasAttachmentContent(report.screenshot, report.hasScreenshot)}
                >
                  Screenshot
                </Button>
              </div>
              {report.screenshot ? (
                <ScreenshotViewer report={report} />
              ) : loadingDetail ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
            </section>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Report details unavailable.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
