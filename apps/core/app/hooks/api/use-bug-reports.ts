import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import { normalizeAdminBugReportRow, UI_STATUS_TO_CORE } from "@eduai/ui";
import type { AdminBugReportRow, BugReportStatus, RawAdminBugReport } from "@eduai/ui";

/**
 * The admin list endpoint returns the full row — including the captured
 * evidence (`consoleLogs`, `networkLogs`, `screenshot`, `pageUrl`, `userAgent`,
 * `context`). Core's client previously declared none of those, so an admin
 * could not open a screenshot that was sitting in the response.
 */
type AdminBugReportsResponse = {
  reports: RawAdminBugReport[];
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
      // The shared normaliser handles the enum casing, the userName/userEmail →
      // reporterName/reporterEmail rename, and flattening the `context` blob's
      // course/module/lesson/activity ids that `getContextLabel` reads.
      setReports(data.reports.map(normalizeAdminBugReportRow));
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
    const report = await apiFetch<RawAdminBugReport>(`/api/admin/bug-reports/${id}`);
    return normalizeAdminBugReportRow(report) satisfies Partial<AdminBugReportRow>;
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
