import { useCallback, useState } from "react";

import type { SubmitBugReportInput } from "~/hooks/api/types";

export function useSubmitBugReport() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitBugReport = useCallback(
    async (input: SubmitBugReportInput): Promise<boolean> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/bug-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: input.description.trim(),
            bugType: input.bugType ?? null,
            isAnonymous: input.isAnonymous ?? false,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to submit bug report");
        }

        // Backend returns 201 with no body — success is indicated by status alone.
        return true;
      } catch (err) {
        console.error("Failed to submit bug report:", err);
        setError(err instanceof Error ? err.message : "Failed to submit bug report");
        return false;
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
  };
}
