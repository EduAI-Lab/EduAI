/**
 * @file AI Tutor's bug-report triage tab.
 *
 * The table, filter bar, viewers, and sorting now live in `@eduai/ui`
 * (`BugReportsAdminView`) — this file is only the AI Tutor data wiring for it.
 * All three apps read the same `bug_reports` table through the same Core
 * endpoint; this app's server is a proxy that pins `source=AI_TUTOR`.
 *
 * Anonymity masking stays server-side in `server/src/utils/bugReportMappers.js`.
 *
 * List vs detail (#979): list rows omit the console/network/screenshot bodies
 * and carry only `has*` flags, so `onLoadDetail` below hands the shared view a
 * fetcher for `GET /api/admin/bug-reports/:id`.
 *
 * Laid out as on Core's Bug reports page: the compact table whose rows open
 * the whole report in a side panel, the open report kept in `?report=` so it
 * can be linked and survives a reload. The page header carries the title.
 */
import { useSearchParams } from "react-router";
import { BugReportsAdminView } from "@eduai/ui";
import type { AdminBugReportRow, BugReportStatus } from "@eduai/ui";

import api from "~/lib/api";

export default function BugReportsTab({ initialReports }: { initialReports: AdminBugReportRow[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const setOpenReportId = (reportId: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (reportId) next.set("report", reportId);
        else next.delete("report");
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <BugReportsAdminView
      className="animate-fade-up delay-150"
      reports={initialReports}
      hideHeader
      layout="panel"
      openReportId={searchParams.get("report")}
      onOpenReportChange={setOpenReportId}
      onUpdateStatus={(reportId: string, status: BugReportStatus) =>
        api.updateAdminBugReportStatus(reportId, { status })
      }
      onLoadDetail={(reportId: string) => api.getAdminBugReport(reportId)}
    />
  );
}
