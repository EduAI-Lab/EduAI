import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type { BugReport, BugReportStatus } from "~/hooks/api/types";

type AdminBugReportsResponse = {
  reports: Array<{
    id: string;
    description: string;
    status: BugReportStatus;
    source: BugReport["source"];
    isAnonymous: boolean;
    userName: string | null;
    userEmail: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export function useBugReports() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiFetch<AdminBugReportsResponse>("/api/admin/bug-reports");
      setReports(
        data.reports.map((r) => ({
          id: r.id,
          description: r.description,
          status: r.status,
          source: r.source,
          isAnonymous: r.isAnonymous,
          reporterName: r.userName,
          reporterEmail: r.userEmail,
          createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
          updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(r.updatedAt).toISOString(),
        })),
      );
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

  const updateReportStatus = useCallback(
    async (id: string, status: BugReportStatus) => {
      await apiFetch<void>(`/api/admin/bug-reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setReports((current) =>
        current.map((report) =>
          report.id === id
            ? { ...report, status, updatedAt: new Date().toISOString() }
            : report,
        ),
      );
    },
    [],
  );

  return {
    reports,
    isLoading,
    error,
    refresh,
    updateReportStatus,
    isStubbed: false,
  };
}
