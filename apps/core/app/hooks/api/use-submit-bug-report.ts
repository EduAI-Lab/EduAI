import { useCallback, useState } from "react";

import type { BugReport, SubmitBugReportInput } from "~/hooks/api/types";

export function useSubmitBugReport() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitBugReport = useCallback(
    async (input: SubmitBugReportInput): Promise<BugReport | null> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/bug-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: input.title?.trim()
              ? `${input.title.trim()}\n\n${input.description.trim()}`
              : input.description.trim(),
            isAnonymous: input.isAnonymous ?? false,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to submit bug report");
        }

        return {
          id: `core-bug-${Date.now()}`,
          title: input.title,
          description: input.description,
          status: "OPEN",
          source: "CORE",
          isAnonymous: input.isAnonymous ?? false,
          reporterName: null,
          reporterEmail: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
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
    isStubbed: false,
  };
}
