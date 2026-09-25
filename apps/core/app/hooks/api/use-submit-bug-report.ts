import { useCallback, useState } from "react";

import type { SubmitBugReportInput } from "~/hooks/api/types";

type SubmitBugReportResult = { ok: true } | { ok: false; error: string };

export function useSubmitBugReport() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitBugReport = useCallback(
    async (input: SubmitBugReportInput): Promise<SubmitBugReportResult> => {
      setIsSubmitting(true);
      setError(null);

      const { description, bugType, isAnonymous, ...diagnostics } = input;

      try {
        const response = await fetch("/api/bug-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: description.trim(),
            bugType: bugType ?? null,
            isAnonymous: isAnonymous ?? false,
            // Diagnostics ride along only when the reporter opted in and the
            // dialog filled them; absent fields stay out of the body entirely.
            ...Object.fromEntries(
              Object.entries(diagnostics).filter(([, v]) => v !== null && v !== undefined),
            ),
          }),
        });

        if (!response.ok) {
          // SAFETY: Core's API errors are `{ error: string }`; a missing or non-JSON
          // body falls back to `{}`, and `error` is only read as an optional string.
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to submit bug report");
        }

        // Backend returns 201 with no body — success is indicated by status alone.
        return { ok: true };
      } catch (err) {
        console.error("Failed to submit bug report:", err);
        const message = err instanceof Error ? err.message : "Failed to submit bug report";
        setError(message);
        return { ok: false, error: message };
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
