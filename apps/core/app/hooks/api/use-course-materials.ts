import type { JsonObject } from "~/lib/json-value";
import { useState, useEffect, useCallback } from "react";
import { asText } from "~/lib/json-value";

export interface CourseMaterial {
  id: string;
  courseId: string;
  title: string;
  mimeType: string;
  fileSize: number;
  status: "PROCESSING" | "READY" | "FAILED";
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  chunkCount?: number;
  /** Owner FK; null on rows with no owner (e.g. pre-#294 rows). */
  uploadedBy?: string;
  /** Student-visibility gate (staff-only field). See #839. */
  visibleToStudents?: boolean;
  /** Scheduled reveal timestamp (ISO) or null. Staff-only. See #839. */
  availableAt?: string | null;
  /**
   * Set on a FAILED row when background extraction found this upload's content
   * already present on the course (#949) — points at the material that won.
   */
  duplicateOfId?: string | null;
  /**
   * Set alongside `duplicateOfId` (#1791): `RESTORED` when this upload revived
   * the material it points at (a failed or deleted one coming back), `EXISTING`
   * when that material was already there and nothing was added.
   */
  duplicateResolution?: MaterialDuplicateResolution | null;
  /** Why a FAILED row failed (#1791); null on rows that predate the column. */
  failureCode?: MaterialFailureCode | null;
}

/**
 * Why a material's background processing failed (#1791). Mirrors the Prisma
 * enum; the UI turns these into sentences in `materialFailureMessage`.
 */
export type MaterialFailureCode =
  | "MATERIAL_EXTRACT_FAILED"
  | "MATERIAL_EXTRACT_BUSY"
  | "MATERIAL_EXTRACT_ABANDONED"
  | "MATERIAL_EMBED_FAILED"
  | "MATERIAL_EMBED_RATE_LIMITED";

export type MaterialDuplicateResolution = "EXISTING" | "RESTORED";

/**
 * Outcome of an upload once background processing has settled (#949). The POST
 * itself only returns 202 + a materialId; everything below is resolved by
 * polling the materials list until the row leaves PROCESSING.
 *
 * - `ready`      — extracted and embedded, the material is usable.
 * - `restored`   — this upload revived a material that was failed or deleted
 *                  (#1791). A success: the content is on the course *because of
 *                  this upload*, which is why it is not folded into `duplicate`.
 * - `duplicate`  — the content already existed and nothing was added;
 *                  `duplicateOfId` is the winner. Replaces the old 409.
 * - `failed`     — extraction or embedding failed; `failureCode` says which and
 *                  whether it is worth retrying.
 * - `processing` — still running when the client stopped watching. Not an
 *                  error: the row keeps processing server-side.
 */
export type UploadOutcome =
  | { status: "ready"; materialId: string }
  | { status: "restored"; materialId: string; duplicateOfId: string }
  | { status: "duplicate"; materialId: string; duplicateOfId: string }
  | { status: "failed"; materialId: string; failureCode: MaterialFailureCode | null }
  | { status: "processing"; materialId: string };

/** How often to re-read the list while an upload is still PROCESSING. */
const UPLOAD_POLL_INTERVAL_MS = 1500;
/** Give up watching after this long; the server keeps going regardless. */
const UPLOAD_POLL_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * Slow re-read that stays alive for as long as *any* row is still PROCESSING
 * (#1494 review). `watchUpload` gives up after five minutes, but the UI tells
 * the user "the list will update when it finishes" — without this the list
 * would then sit stale forever. Deliberately much slower than the active poll:
 * this is the long tail, not the common case.
 */
const BACKGROUND_REFRESH_INTERVAL_MS = 30 * 1000;

/** Cursor "load more" course materials (#1042) — bounded per page instead of one unbounded fetch. */
export function useCourseMaterials(courseId: string) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const res = await fetch(`/api/courses/${courseId}/materials${query}`);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as { materials: CourseMaterial[]; nextCursor: string | null };
    },
    [courseId],
  );

  const fetchMaterials = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage(null);
      setMaterials(data.materials);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch materials");
    } finally {
      setLoading(false);
    }
  }, [courseId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      setMaterials((prev) => [...prev, ...data.materials]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more materials");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, nextCursor, loadingMore]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const deleteMaterial = useCallback(
    async (materialId: string): Promise<void> => {
      const res = await fetch(`/api/courses/${courseId}/materials/${materialId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchMaterials();
    },
    [courseId, fetchMaterials],
  );

  /**
   * Merge one freshly-read row into local state without clobbering pages the
   * user already loaded via `loadMore` — a poll only re-reads page 1.
   */
  const mergeMaterial = useCallback((row: CourseMaterial) => {
    setMaterials((prev) =>
      prev.some((m) => m.id === row.id)
        ? prev.map((m) => (m.id === row.id ? row : m))
        : [row, ...prev],
    );
  }, []);

  /**
   * Quiet re-read of page 1: refreshes the rows already on screen and picks up
   * rows added since the last read, without touching `loading` (which would
   * flash the whole list into its skeleton) or `nextCursor` (which would
   * discard pages the user loaded via `loadMore`). Errors are swallowed — the
   * next tick retries, and a transient read failure is not worth surfacing over
   * a list the user can already see.
   */
  const refreshFirstPage = useCallback(async () => {
    try {
      const data = await fetchPage(null);
      setMaterials((prev) => {
        const fresh = new Map(data.materials.map((m) => [m.id, m]));
        const known = new Set(prev.map((m) => m.id));
        const updated = prev.map((m) => fresh.get(m.id) ?? m);
        const added = data.materials.filter((m) => !known.has(m.id));
        return added.length > 0 ? [...added, ...updated] : updated;
      });
    } catch {
      /* transient read failure — the next tick retries */
    }
  }, [fetchPage]);

  const hasProcessingRow = materials.some((m) => m.status === "PROCESSING");

  useEffect(() => {
    if (!courseId || !hasProcessingRow) return;
    const timer = setInterval(() => {
      void refreshFirstPage();
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [courseId, hasProcessingRow, refreshFirstPage]);

  /**
   * Watch a material until it leaves PROCESSING (#949). Uploads are ordered
   * newest-first, so a brand-new row is always on page 1.
   *
   * `isReceipt` travels alongside the outcome rather than inside it because it
   * answers a different question (#1791). The outcome says what the *user* is
   * told; this says whether the watched row is a bookkeeping receipt pointing at
   * some other material, and therefore whether to delete it. A failed restore is
   * both — reported as `failed`, and still a receipt to clean up — so neither
   * fact can be derived from the other.
   */
  const watchUpload = useCallback(
    async (materialId: string): Promise<{ outcome: UploadOutcome; isReceipt: boolean }> => {
      const deadline = Date.now() + UPLOAD_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS));
        let page: { materials: CourseMaterial[] };
        try {
          page = await fetchPage(null);
        } catch {
          continue; // transient read failure — the row is still processing server-side
        }
        const row = page.materials.find((m) => m.id === materialId);
        if (!row) return { outcome: { status: "processing", materialId }, isReceipt: false };
        mergeMaterial(row);
        if (row.status === "READY") {
          return { outcome: { status: "ready", materialId }, isReceipt: false };
        }
        if (row.status === "FAILED") {
          const failureCode = row.failureCode ?? null;
          const duplicateOfId = row.duplicateOfId ?? null;
          const isReceipt = duplicateOfId !== null;
          // A receipt carrying a reason is a failed restore, not a duplicate
          // (#1791): the upload pointed at an existing material and tried to
          // revive it, and that attempt died. Reporting it as "already exists"
          // is what made a rate-limited upload look permanent.
          if (duplicateOfId !== null && !failureCode) {
            return {
              outcome: {
                status: row.duplicateResolution === "RESTORED" ? "restored" : "duplicate",
                materialId,
                duplicateOfId,
              },
              isReceipt,
            };
          }
          return { outcome: { status: "failed", materialId, failureCode }, isReceipt };
        }
      }
      return { outcome: { status: "processing", materialId }, isReceipt: false };
    },
    [fetchPage, mergeMaterial],
  );

  /**
   * Upload a file. The endpoint returns 202 as soon as the row is persisted
   * (#949) — extraction and embedding run in the background — so this shows the
   * PROCESSING row immediately and then resolves once it settles.
   *
   * A duplicate is reported late rather than as a 409. The server leaves a
   * FAILED receipt row pointing at the winner; we read it, then delete it so
   * repeated attempts don't pile up in the list. A *failed* restore leaves a
   * receipt too (#1791) — the material it points at carries the real failure, so
   * the receipt is cleaned up the same way rather than doubling the failure in
   * the list.
   */
  const uploadMaterial = useCallback(
    async (file: File): Promise<UploadOutcome> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/courses/${courseId}/materials`, {
        method: "POST",
        body: formData,
      });
      // SAFETY: `Response#json` resolves to whatever the server sent; the only
      // field read below is checked for its own type first.
      const body = (await res.json().catch(() => ({}))) as JsonObject;
      if (!res.ok) {
        throw new Error(asText(body.error) ?? `Upload failed (${res.status})`);
      }

      const materialId = body.materialId as string;
      await fetchMaterials(); // paint the PROCESSING row right away
      const { outcome, isReceipt } = await watchUpload(materialId);

      if (isReceipt) {
        await deleteMaterial(materialId).catch(() => {
          /* receipt cleanup is best-effort; the outcome is already known */
        });
        // The receipt is gone but the material it pointed at may have just
        // changed (restored to READY, or failed with a reason), and that row is
        // not the one we were watching (#1791).
        await refreshFirstPage();
      }
      return outcome;
    },
    [courseId, fetchMaterials, watchUpload, deleteMaterial, refreshFirstPage],
  );

  return {
    materials,
    loading,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    uploadMaterial,
    deleteMaterial,
    refetch: fetchMaterials,
  };
}
