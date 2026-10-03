import type { MaterialStatus } from "@eduai/ui";
import type { MaterialFailureCode } from "~/hooks/api/use-course-materials";

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
  /**
   * The reason the background job recorded (#1791/#1794), when the row has
   * one. Null on a row that failed before the column existed, and on a
   * duplicate receipt (which has no failure of its own to explain). Refines
   * the message within whatever bucket `duplicateOfId`/`hasExtractedText`
   * already put the row in — it never changes `kind` or `canRetry`, which
   * stay derived from the row's shape: a code says what class of failure this
   * is, but only the shape says whether the server actually has something to
   * retry from.
   */
  failureCode: MaterialFailureCode | null;
};

/**
 * Per-code copy (#1794), more specific than the three shape-derived messages
 * below. `satisfies`, not an annotation: every code must be listed, while the
 * literal's own type stays intact for the lookup below — an explicit open
 * dictionary type would discard that a code not on this list is a type error,
 * not a value this ever has to handle at runtime.
 */
const FAILURE_CODE_TEXT = {
  MATERIAL_EXTRACT_FAILED: {
    title: "Couldn't read this file",
    description:
      "Couldn't read the contents of this file. It may be corrupted, password-protected, or a scan with no selectable text.",
  },
  MATERIAL_EXTRACT_BUSY: {
    title: "The server was too busy to process this file",
    description:
      "The server was too busy to process this file after several attempts. Nothing is wrong with the file — try again in a few minutes.",
  },
  MATERIAL_EXTRACT_ABANDONED: {
    title: "Processing didn't complete",
    description:
      "Processing this file was attempted several times and didn't complete. Try again, or upload a smaller or simpler version of the file.",
  },
  MATERIAL_EMBED_FAILED: {
    title: "Couldn't prepare this file for search",
    description:
      "The file was read successfully, but its search data couldn't be built. Try again — if it keeps failing, contact your administrator.",
  },
  MATERIAL_EMBED_RATE_LIMITED: {
    title: "Rate-limited while indexing",
    description:
      "The AI service is rate-limiting requests right now, so this file's search data couldn't be built. The file itself is fine — try again in a few minutes.",
  },
} satisfies Record<MaterialFailureCode, { title: string; description: string }>;

/**
 * Explain a FAILED material from the row.
 *
 * #1749: the failed badge carried no reason and no recovery, so the only way
 * to make progress was to re-upload and hope. #1794 then gave the background
 * job a column to record *why* on the row itself (`failureCode`), but a row
 * can still predate that column, or carry a code this client build does not
 * recognize — so the derivation below still starts from what every row has:
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
 * `failureCode`, when present and recognized, only swaps in a more specific
 * title/description within whichever of those three buckets the shape already
 * chose — `canRetry` keeps coming from the shape, because that is what the
 * reprocess endpoint itself checks (`MATERIAL_TEXT_UNAVAILABLE`), and codes
 * like `MATERIAL_EXTRACT_ABANDONED` can be reached both with and without text
 * left to retry from.
 *
 * Returns `null` for any material that has not failed.
 */
export function describeMaterialFailure(
  material: MaterialFailureFacts,
): MaterialFailureNotice | null {
  if (material.status !== "FAILED") return null;

  const specific = material.failureCode ? FAILURE_CODE_TEXT[material.failureCode] : undefined;

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
      title: specific?.title ?? "Couldn't read this file",
      description:
        specific?.description ??
        "No usable text could be extracted, so there is nothing to retry — the original upload is no longer stored. Check the file opens correctly, then upload it again.",
      canRetry: false,
      duplicateOfId: null,
    };
  }

  return {
    kind: "indexing-failed",
    title: specific?.title ?? "Couldn't prepare this file for search",
    description:
      specific?.description ??
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
