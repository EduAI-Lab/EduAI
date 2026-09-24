import type { JsonObject } from "~/lib/json-value";
import { useState, useEffect, useCallback, useRef } from "react";
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
   * Present only on FAILED rows (#1749): whether the extracted text survived
   * on the server, which is what decides if indexing can be retried without
   * the instructor uploading the file again. The text itself never reaches
   * the client — the list resolves this server-side.
   */
  hasExtractedText?: boolean;
}

/**
 * Outcome of an upload once background processing has settled (#949). The POST
 * itself only returns 202 + a materialId; everything below is resolved by
 * polling the materials list until the row leaves PROCESSING.
 *
 * - `ready`      — extracted and embedded, the material is usable.
 * - `duplicate`  — the content already existed; `duplicateOfId` is the winner.
 *                  This replaces the old synchronous 409.
 * - `failed`     — extraction or embedding failed; the row is FAILED.
 * - `processing` — still running when the client stopped watching. Not an
 *                  error: the row keeps processing server-side.
 */
export type UploadOutcome =
  | { status: "ready"; materialId: string }
  | { status: "duplicate"; materialId: string; duplicateOfId: string }
  | { status: "failed"; materialId: string }
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

  /**
   * Re-read specific rows the client already holds (#1795 review round 3).
   * Deliberately not a page: it carries no cursor either way, so merging its
   * answer cannot disturb the pages loaded with `loadMore`.
   */
  const fetchByIds = useCallback(
    async (ids: string[]) => {
      const query = encodeURIComponent(ids.join(","));
      const res = await fetch(`/api/courses/${courseId}/materials?ids=${query}`);
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
   * Retry a failed material's indexing from the text already on the server
   * (#1749). The endpoint answers 202 and returns the row to PROCESSING, so
   * the list's existing processing poll reports the outcome — same shape as
   * an upload, and no file is sent.
   *
   * The row is updated in place rather than by reloading the list (#1795 review
   * round 3). `fetchMaterials` replaces everything with page 1 and resets the
   * cursor, which discards every page loaded with "load more" — and because the
   * list is newest-first, an older failed material is usually *on* one of those
   * pages, so the row the instructor just retried would vanish from the screen.
   * Uploads never hit this: a new row is always on page 1.
   *
   * The local edit mirrors the 202 the server just committed, so nothing here
   * is guessed: the row is PROCESSING, its failure is over, and the affordances
   * that belong to that failure go with it rather than offering "Try again" for
   * a retry already running.
   */
  const reprocessMaterial = useCallback(
    async (materialId: string): Promise<void> => {
      const res = await fetch(`/api/courses/${courseId}/materials/${materialId}/reprocess`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      setMaterials((prev) =>
        prev.map((m) =>
          m.id === materialId
            ? {
                ...m,
                status: "PROCESSING",
                processedAt: null,
                hasExtractedText: undefined,
                duplicateOfId: null,
              }
            : m,
        ),
      );
    },
    [courseId],
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
  const refreshFirstPage = useCallback(async (): Promise<Set<string> | null> => {
    try {
      const data = await fetchPage(null);
      setMaterials((prev) => {
        const fresh = new Map(data.materials.map((m) => [m.id, m]));
        const known = new Set(prev.map((m) => m.id));
        const updated = prev.map((m) => fresh.get(m.id) ?? m);
        const added = data.materials.filter((m) => !known.has(m.id));
        return added.length > 0 ? [...added, ...updated] : updated;
      });
      // Which rows this tick actually refreshed, so the caller can tell what
      // page 1 could not reach.
      return new Set(data.materials.map((m) => m.id));
    } catch {
      /* transient read failure — the next tick retries */
      return null;
    }
  }, [fetchPage]);

  // Read by the poll below, which runs long after the render that scheduled it
  // and must see the list as it is now rather than as it was then.
  const materialsRef = useRef<CourseMaterial[]>([]);
  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  /**
   * One poll tick: refresh page 1, then re-read by id any PROCESSING row page 1
   * did not return (#1795 review round 3).
   *
   * A retried material is the first PROCESSING row that can live past page 1 —
   * uploads are newest-first, so their rows are always on page 1 — and a
   * page-1-only poll can never settle it. Such a row sat on "Processing" until
   * a full page reload.
   *
   * The second read is skipped whenever page 1 already covered everything being
   * watched, which is the upload case and so the overwhelmingly common one: no
   * extra request for a list that does not need it.
   */
  const refreshProcessingRows = useCallback(async () => {
    const watching = materialsRef.current.filter((m) => m.status === "PROCESSING").map((m) => m.id);
    const covered = await refreshFirstPage();
    // Page 1 failed; the next tick retries both halves rather than half-working.
    if (!covered) return;

    const missing = watching.filter((id) => !covered.has(id));
    if (missing.length === 0) return;
    try {
      const data = await fetchByIds(missing);
      for (const row of data.materials) mergeMaterial(row);
    } catch {
      /* transient read failure — the next tick retries */
    }
  }, [fetchByIds, mergeMaterial, refreshFirstPage]);

  const hasProcessingRow = materials.some((m) => m.status === "PROCESSING");

  useEffect(() => {
    if (!courseId || !hasProcessingRow) return;
    const timer = setInterval(() => {
      void refreshProcessingRows();
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [courseId, hasProcessingRow, refreshProcessingRows]);

  /**
   * Watch a material until it leaves PROCESSING (#949). Uploads are ordered
   * newest-first, so a brand-new row is always on page 1.
   */
  const watchUpload = useCallback(
    async (materialId: string): Promise<UploadOutcome> => {
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
        if (!row) return { status: "processing", materialId };
        mergeMaterial(row);
        if (row.status === "READY") return { status: "ready", materialId };
        if (row.status === "FAILED") {
          return row.duplicateOfId
            ? { status: "duplicate", materialId, duplicateOfId: row.duplicateOfId }
            : { status: "failed", materialId };
        }
      }
      return { status: "processing", materialId };
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
   * repeated attempts don't pile up in the list.
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
      const outcome = await watchUpload(materialId);

      if (outcome.status === "duplicate") {
        await deleteMaterial(materialId).catch(() => {
          /* receipt cleanup is best-effort; the outcome is already known */
        });
      }
      return outcome;
    },
    [courseId, fetchMaterials, watchUpload, deleteMaterial],
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
    reprocessMaterial,
    refetch: fetchMaterials,
  };
}
