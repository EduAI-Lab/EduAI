/**
 * User-facing sentences for a material's `failureCode` (#1791).
 *
 * The background job records *why* a material failed, but only an operator could
 * read it: the reason went to `system_errors`, and every instructor saw the same
 * "Processing failed for this file. Please try again." A rate-limited embedding
 * provider and a genuinely unreadable PDF are opposite situations — one wants
 * patience, the other wants a different file — and collapsing them is how a
 * transient failure got reported as a permanent one.
 *
 * Each message therefore answers two questions: what went wrong, and is
 * retrying the same file worth anything. `retryable` drives the retry button, so
 * we never invite someone to re-upload a file that will fail identically.
 */
import type { MaterialFailureCode } from "~/hooks/api/use-course-materials";

export type MaterialFailure = {
  message: string;
  /** Whether re-uploading the same bytes has a real chance of succeeding. */
  retryable: boolean;
};

// `satisfies`, not an annotation: it still forces every code to be listed, while
// leaving the literal's own type intact for the lookup below.
const FAILURES = {
  MATERIAL_EXTRACT_FAILED: {
    message:
      "Couldn't read the contents of this file. It may be corrupted, password-protected, or a scan with no selectable text.",
    retryable: false,
  },
  MATERIAL_EXTRACT_BUSY: {
    message:
      "The server was too busy to process this file after several attempts. Nothing is wrong with the file — try again in a few minutes.",
    retryable: true,
  },
  MATERIAL_EXTRACT_ABANDONED: {
    message:
      "Processing this file was attempted several times and didn't complete. Try again, or upload a smaller or simpler version of the file.",
    retryable: true,
  },
  MATERIAL_EMBED_FAILED: {
    message:
      "The file was read successfully, but its search data couldn't be built. Try again — if it keeps failing, contact your administrator.",
    retryable: true,
  },
  MATERIAL_EMBED_RATE_LIMITED: {
    message:
      "The AI service is rate-limiting requests right now, so this file's search data couldn't be built. The file itself is fine — try again in a few minutes.",
    retryable: true,
  },
} satisfies Record<MaterialFailureCode, MaterialFailure>;

/**
 * Null covers rows that failed before the column existed, and any code a newer
 * server sends that this client does not know yet. Both get the old generic
 * sentence — and are treated as retryable, because "we don't know" is not a
 * reason to take the retry away.
 */
const UNKNOWN_FAILURE: MaterialFailure = {
  message: "Processing failed for this file. Please try again.",
  retryable: true,
};

export function materialFailure(code: MaterialFailureCode | null | undefined): MaterialFailure {
  if (!code) return UNKNOWN_FAILURE;
  return FAILURES[code] ?? UNKNOWN_FAILURE;
}

export function materialFailureMessage(code: MaterialFailureCode | null | undefined): string {
  return materialFailure(code).message;
}
