import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import { toUiStatus, UI_STATUS_TO_CORE } from "@eduai/ui";
import type { AdminBugReportRow, BugReportStatus } from "@eduai/ui";

/**
 * The admin list endpoint returns the full row — including the captured
 * evidence (`consoleLogs`, `networkLogs`, `screenshot`, `pageUrl`, `userAgent`,
 * `context`). Core's client previously declared none of those, so an admin
 * could not open a screenshot that was sitting in the response.
 */
type AdminBugReportsResponse = {
  reports: AdminBugReportRow[];
  total?: number;
  limit?: number;
  offset?: number;
};

/**
 * The server clamps `limit` to 200 and defaults it to 50. Core previously sent
 * nothing and silently showed the first 50, while both extensions asked for
 * 100 — so the platform-wide page listed fewer reports than the per-app ones,
 * with no indication. Ask for the server maximum and report any remainder.
 */
const PAGE_LIMIT = 200;

export function useBugReports() {
  const [reports, setReports] = useState<AdminBugReportRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiFetch<AdminBugReportsResponse>(
        `/api/admin/bug-reports?limit=${PAGE_LIMIT}`,
      );
      setReports(
        data.reports.map((r) => ({
          ...r,
          bugType: r.bugType ?? null,
          // Core returns the Prisma enum; the shared view renders lowercase.
          status: toUiStatus(r.status as unknown as string),
          // Core's payload names the reporter userName/userEmail; the shared row
          // reads reporterName/reporterEmail first and falls back to these.
          reporterName: r.reporterName ?? r.userName ?? null,
          reporterEmail: r.reporterEmail ?? r.userEmail ?? null,
          createdAt:
            typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
        })),
      );
      setTotal(typeof data.total === "number" ? data.total : null);
    } catch (err) {
      console.error("Failed to fetch bug reports:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch bug reports");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The list endpoint omits the diagnostic blobs (#979) and sends only `has*`
   * flags; the shared view calls this when a viewer or copy needs the bodies.
   */
  const loadReportDetail = useCallback(async (id: string) => {
    const report = await apiFetch<AdminBugReportRow>(`/api/admin/bug-reports/${id}`);
    return {
      ...report,
      bugType: report.bugType ?? null,
      status: toUiStatus(report.status as unknown as string),
      reporterName: report.reporterName ?? report.userName ?? null,
      reporterEmail: report.reporterEmail ?? report.userEmail ?? null,
    } satisfies Partial<AdminBugReportRow>;
  }, []);

  const updateReportStatus = useCallback(async (id: string, status: BugReportStatus) => {
    await apiFetch<void>(`/api/admin/bug-reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: UI_STATUS_TO_CORE[status] ?? status }),
    });
    return { status, updatedAt: new Date().toISOString() };
  }, []);

  return {
    reports,
    total,
    isLoading,
    error,
    refresh,
    updateReportStatus,
    loadReportDetail,
  };
}
