import type { MaterialStatus } from "@eduai/ui";

/**
 * Why a material upload ended in FAILED, at the granularity the *instructor*
 * can act on: it's already here (`duplicate`), we couldn't read your file
 * (`unreadable-file`), or we read it but couldn't index it (`indexing-failed`).
 */
export type MaterialFailureKind = "duplicate" | "unreadable-file" | "indexing-failed";

export type MaterialFailureNotice = {
  kind: MaterialFailureKind;
  title: string;
  description: string;
  /**
   * Whether re-running the pipeline can succeed without the instructor
   * re-uploading. Only true when the extracted text is still on the row —
   * `failMaterial` discards the upload blob, so anything that died before
   * `rawText` was written has no bytes left to retry from.
   */
  canRetry: boolean;
  /** The material this upload turned out to duplicate, for `kind: "duplicate"`. */
  duplicateOfId: string | null;
};

/**
 * The fields of a material row this derivation reads. Deliberately narrow: the
 * API list response carries all three, and none of them is the document text.
 */
export type MaterialFailureFacts = {
  status: MaterialStatus;
  duplicateOfId: string | null;
  /** `rawText !== null` on the row — computed server-side, never the text itself. */
  hasExtractedText: boolean;
};

/**
 * Explain a FAILED material from the row alone.
 *
 * #1749: the failed badge carried no reason and no recovery, so the only way
 * to make progress was to re-upload and hope. The reason the background job
 * recorded is not readable here — `failMaterial` writes only `status`, sending
 * the message to `logSystemError`, and `CourseMaterial` has no column for it
 * (#1794). What the row *does* distinguish is the stage that failed, which is
 * what decides whether retrying is even possible:
 *
 * - `duplicateOfId` set — the content checksummed to a material already on the
 *   course (#949's async successor to the old synchronous 409).
 * - no extracted text — extraction died, and `failMaterial` discarded the
 *   upload blob, so there is nothing left to re-run against.
 * - text extracted — `rawText` was written before embedding
 *   (`extraction-job.server.ts`), so re-embedding can run straight from the
 *   database. `processMaterialEmbeddings` uses `replace: true` and is
 *   idempotent, which is what makes that safe to repeat.
 *
 * Returns `null` for any material that has not failed.
 */
export function describeMaterialFailure(
  material: MaterialFailureFacts,
): MaterialFailureNotice | null {
  if (material.status !== "FAILED") return null;

  // Checked first: a duplicate receipt always has extracted text — it got far
  // enough to checksum the content — so the indexing branch would claim it.
  if (material.duplicateOfId !== null) {
    return {
      kind: "duplicate",
      title: "This file is already on the course",
      description:
        "Nothing was added, because the same content is already uploaded here. You can safely remove this entry.",
      canRetry: false,
      duplicateOfId: material.duplicateOfId,
    };
  }

  if (!material.hasExtractedText) {
    return {
      kind: "unreadable-file",
      title: "Couldn't read this file",
      description:
        "No usable text could be extracted, so there is nothing to retry — the original upload is no longer stored. Check the file opens correctly, then upload it again.",
      canRetry: false,
      duplicateOfId: null,
    };
  }

  return {
    kind: "indexing-failed",
    title: "Couldn't prepare this file for search",
    description:
      "The text was read successfully, but indexing it for course chat failed. The text is still saved, so this can be retried without uploading the file again.",
    canRetry: true,
    duplicateOfId: null,
  };
}

/**
 * Copy for a retry the server refused (#1795 review).
 *
 * `reprocessMaterial` throws on any non-2xx with the raw response body as its
 * message, so what arrives here is `{"error":"MATERIAL_TEXT_UNAVAILABLE"}`, a
 * proxy's HTML error page, or a fetch failure's own text. None of those belong
 * in front of an instructor, and none of them was shown at all before: the
 * rejection had no `catch`, so the only feedback was "Retrying…" flashing and
 * the button coming back.
 *
 * Each refusal the route can answer with is a different next step, which is why
 * they are not collapsed into one apology. Anything unrecognised — a 500, a
 * dropped connection — says only that the retry did not happen, because that is
 * all that is actually known.
 */
export function describeMaterialRetryFailure(message: string): string {
  switch (readErrorCode(message)) {
    case "MATERIAL_NOT_FAILED":
      // The row settled between the list read and the click: a poll or another
      // tab already resolved it, so there is nothing to retry.
      return "This material is no longer failed — refresh to see where it got to.";
    case "MATERIAL_DUPLICATE":
      return "This file is already on the course, so there is nothing to retry.";
    case "MATERIAL_TEXT_UNAVAILABLE":
      return "The extracted text is no longer available, so this cannot be retried. Upload the file again.";
    case "MATERIAL_NOT_FOUND":
      return "This material is no longer on the course.";
    case "Forbidden":
      return "You do not have permission to retry this material.";
    default:
      return "Couldn't retry this material. Try again in a moment.";
  }
}

/**
 * The `error` code out of an API error body, or null for a body that is not
 * one — an HTML error page from a proxy, or a network failure's message.
 */
function readErrorCode(message: string): string | null {
  try {
    // SAFETY: the shape is asserted, not trusted. Every branch above matches a
    // known string code, so a body carrying anything else under `error` — or no
    // `error` at all — simply matches nothing and falls through to the generic
    // copy, which is the right answer for a response this did not recognise.
    const parsed = JSON.parse(message) as { error?: string } | null;
    return parsed?.error ?? null;
  } catch {
    return null;
  }
}
