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
   * Set alongside `duplicateOfId` (#1791): `RESTORED` when this upload revived
   * the material it points at (a failed or deleted one coming back), `EXISTING`
   * when that material was already there and nothing was added.
   */
  duplicateResolution?: MaterialDuplicateResolution | null;
  /** Why a FAILED row failed (#1791); null on rows that predate the column. */
  failureCode?: MaterialFailureCode | null;
  /**
   * Present only on FAILED rows (#1749): whether the extracted text survived
   * on the server, which is what decides if indexing can be retried without
   * the instructor uploading the file again. The text itself never reaches
   * the client — the list resolves this server-side.
   */
  hasExtractedText?: boolean;
}

/**
 * Why a material's background processing failed (#1791). Mirrors the Prisma
 * enum; `describeMaterialFailure` (`~/lib/material-failure-notice`) turns a
 * recognized code into a more specific explanation than the row's shape alone
 * can give.
 */
export type MaterialFailureCode =
  | "MATERIAL_EXTRACT_FAILED"
  | "MATERIAL_EXTRACT_BUSY"
  | "MATERIAL_EXTRACT_ABANDONED"
  | "MATERIAL_EMBED_FAILED"
  | "MATERIAL_EMBED_RATE_LIMITED"
  | "MATERIAL_EMBED_PROVIDER_UNAVAILABLE";

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

/**
 * `row` as read by request `seq`, unless a later read already wrote a newer copy
 * (#1748 review). A batch runs several uploads at once, each polling, so list
 * reads resolve out of order; without this an older response could put a row
 * the user just saw settle back into PROCESSING. `seen` maps row id to the
 * newest read that wrote it.
 */
function pickNewer(
  seen: Map<string, number>,
  seq: number,
  row: CourseMaterial,
  current: CourseMaterial | undefined,
): CourseMaterial {
  if (current && (seen.get(row.id) ?? 0) > seq) return current;
  seen.set(row.id, seq);
  return row;
}

/** Cursor "load more" course materials (#1042) — bounded per page instead of one unbounded fetch. */
export function useCourseMaterials(courseId: string) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // The course this hook currently serves (#1748 review). The course page is
  // not remounted when the switcher moves between courses, so an upload or
  // poll started for the previous course can resolve after `courseId` changes;
  // its results must not land in the new course's list.
  const courseIdRef = useRef(courseId);
  useEffect(() => {
    courseIdRef.current = courseId;
  }, [courseId]);

  // Every list read takes a number when it is sent; see `pickNewer`.
  const readSeqRef = useRef(0);
  const rowSeqRef = useRef(new Map<string, number>());
  const lastFullReadRef = useRef(0);

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
    const seq = ++readSeqRef.current;
    lastFullReadRef.current = seq;
    // A newer full read, or a different course, owns the list now.
    const superseded = () => lastFullReadRef.current !== seq || courseIdRef.current !== courseId;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage(null);
      if (superseded()) return;
      setMaterials((prev) => {
        const current = new Map(prev.map((m) => [m.id, m]));
        return data.materials.map((m) => pickNewer(rowSeqRef.current, seq, m, current.get(m.id)));
      });
      setNextCursor(data.nextCursor);
    } catch (e) {
      if (superseded()) return;
      setError(e instanceof Error ? e.message : "Failed to fetch materials");
    } finally {
      if (!superseded()) setLoading(false);
    }
  }, [courseId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      if (courseIdRef.current !== courseId) return;
      setMaterials((prev) => [...prev, ...data.materials]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      if (courseIdRef.current !== courseId) return;
      setError(e instanceof Error ? e.message : "Failed to load more materials");
    } finally {
      setLoadingMore(false);
    }
  }, [courseId, fetchPage, nextCursor, loadingMore]);

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
      if (courseIdRef.current !== courseId) return;
      // Newer than any read still in flight, which would otherwise put the
      // row back to FAILED.
      rowSeqRef.current.set(materialId, ++readSeqRef.current);
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
   * Merge one freshly-read row (read by request `seq`) into local state without
   * clobbering pages the user already loaded via `loadMore` — a poll only
   * re-reads page 1. Dropped once the hook has moved on to another course.
   */
  const mergeMaterial = useCallback((seq: number, row: CourseMaterial) => {
    if (row.courseId !== courseIdRef.current) return;
    setMaterials((prev) => {
      const current = prev.find((m) => m.id === row.id);
      if (!current) {
        rowSeqRef.current.set(row.id, seq);
        return [row, ...prev];
      }
      const next = pickNewer(rowSeqRef.current, seq, row, current);
      return next === current ? prev : prev.map((m) => (m.id === row.id ? next : m));
    });
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
    const seq = ++readSeqRef.current;
    try {
      const data = await fetchPage(null);
      if (courseIdRef.current !== courseId) return null;
      setMaterials((prev) => {
        const fresh = new Map(data.materials.map((m) => [m.id, m]));
        const known = new Set(prev.map((m) => m.id));
        const updated = prev.map((m) => {
          const row = fresh.get(m.id);
          return row ? pickNewer(rowSeqRef.current, seq, row, m) : m;
        });
        const added = data.materials.filter((m) => !known.has(m.id));
        for (const m of added) rowSeqRef.current.set(m.id, seq);
        return added.length > 0 ? [...added, ...updated] : updated;
      });
      // Which rows this tick actually refreshed, so the caller can tell what
      // page 1 could not reach.
      return new Set(data.materials.map((m) => m.id));
    } catch {
      /* transient read failure — the next tick retries */
      return null;
    }
  }, [courseId, fetchPage]);

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
    const seq = ++readSeqRef.current;
    try {
      const data = await fetchByIds(missing);
      for (const row of data.materials) mergeMaterial(seq, row);
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
   * Watch a material until it leaves PROCESSING (#949). Page 1 is read first,
   * since a new upload is newest-first and normally sits there. Inside a batch
   * (#1748 review) the other files can push a slow one past page 1, so a miss
   * falls back to reading the row by id before concluding anything — "not on
   * page 1" is not "still processing", and treating it so hid FAILED outcomes.
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
        let seq = ++readSeqRef.current;
        let row: CourseMaterial | undefined;
        try {
          row = (await fetchPage(null)).materials.find((m) => m.id === materialId);
          if (!row) {
            seq = ++readSeqRef.current;
            row = (await fetchByIds([materialId])).materials.find((m) => m.id === materialId);
          }
        } catch {
          continue; // transient read failure — the row is still processing server-side
        }
        // Gone entirely (deleted elsewhere): nothing left to watch.
        if (!row) return { outcome: { status: "processing", materialId }, isReceipt: false };
        mergeMaterial(seq, row);
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
    [fetchPage, fetchByIds, mergeMaterial],
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
   *
   * The PROCESSING row is painted with a quiet page-1 merge rather than
   * `fetchMaterials` (#1748 review): a batch runs several of these at once, and
   * a full reload per file would discard "load more" pages each time and race
   * the other files' polls with whole-list replacements.
   *
   * `onAccepted` reports the new material id as soon as the POST lands, before
   * the outcome is known — a batch uses it to recognise its own files.
   */
  const uploadMaterial = useCallback(
    async (
      file: File,
      { onAccepted }: { onAccepted?: (materialId: string) => void } = {},
    ): Promise<UploadOutcome> => {
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
      onAccepted?.(materialId);
      await refreshFirstPage(); // paint the PROCESSING row right away
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
    [courseId, refreshFirstPage, watchUpload, deleteMaterial],
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
