import { useCallback, useState } from "react";

import { STUB_ONLY } from "~/hooks/api/config";
import type { BugReport, SubmitBugReportInput } from "~/hooks/api/types";

export function useSubmitBugReport() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitBugReport = useCallback(
    async (input: SubmitBugReportInput): Promise<BugReport | null> => {
      setIsSubmitting(true);
      setError(null);

      try {
        if (STUB_ONLY.bugReports) {
          const now = new Date().toISOString();
          return {
            id: `bug-stub-${Date.now()}`,
            title: input.title,
            description: input.description,
            status: "OPEN",
            source: "CORE",
            isAnonymous: input.isAnonymous ?? false,
            reporterName: input.isAnonymous ? null : "Current User",
            reporterEmail: input.isAnonymous ? null : null,
            createdAt: now,
            updatedAt: now,
          };
        }

        // Future: POST /api/bug-reports
        return null;
      } catch (err) {
        console.error("Failed to submit bug report:", err);
        setError(err instanceof Error ? err.message : "Failed to submit bug report");
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  return {
    submitBugReport,
    isSubmitting,
    error,
    isStubbed: STUB_ONLY.bugReports,
  };
}
