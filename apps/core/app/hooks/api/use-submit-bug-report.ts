import { useCallback, useState } from "react";

import type { SubmitBugReportInput } from "~/hooks/api/types";

type SubmitBugReportResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Failed to submit bug report";

// `/api/bug-reports` answers with machine codes, which the dialog would show
// verbatim. A `Map` because the key is whatever string the server sent.
const ERROR_MESSAGES = new Map<string, string>([
  ["VALIDATION_ERROR", "Some details were invalid. Please check your description and bug type."],
  ["USER_NOT_FOUND", "We couldn't find your account. Please sign in and try again."],
  ["Unauthorized", "Your session has expired. Please sign in and try again."],
]);

const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

/** Known codes get readable text, other codes the generic message; prose passes through. */
function toReadableError(error: string | undefined) {
  if (!error) return GENERIC_ERROR;
  return ERROR_MESSAGES.get(error) ?? (ERROR_CODE.test(error) ? GENERIC_ERROR : error);
}

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
          // The raw code and fields go to the console; the reporter reads text.
          console.error("Failed to submit bug report:", data);
          const message = toReadableError(data.error);
          setError(message);
          return { ok: false, error: message };
        }

        // Backend returns 201 with no body — success is indicated by status alone.
        return { ok: true };
      } catch (err) {
        console.error("Failed to submit bug report:", err);
        const message = err instanceof Error ? err.message : GENERIC_ERROR;
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
