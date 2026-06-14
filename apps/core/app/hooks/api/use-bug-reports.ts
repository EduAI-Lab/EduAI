import { useCallback, useEffect, useState } from "react";

import { STUB_ONLY } from "~/hooks/api/config";
import { stubBugReports } from "~/hooks/api/fixtures/platform/bug-reports";
import type { BugReport, BugReportStatus } from "~/hooks/api/types";

export function useBugReports() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (STUB_ONLY.bugReports) {
        setReports(stubBugReports);
        return;
      }

      // Future: await apiFetch<BugReport[]>("/api/bug-reports");
      setReports([]);
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
      if (STUB_ONLY.bugReports) {
        setReports((current) =>
          current.map((report) =>
            report.id === id
              ? { ...report, status, updatedAt: new Date().toISOString() }
              : report,
          ),
        );
        return;
      }

      // Future: PATCH /api/bug-reports/:id
    },
    [],
  );

  return {
    reports,
    isLoading,
    error,
    refresh,
    updateReportStatus,
    isStubbed: STUB_ONLY.bugReports,
  };
}
