import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCourseMaterials } from "~/hooks/api/use-course-materials";

const material = {
  id: "mat-1",
  courseId: "course-1",
  title: "Week 1 slides",
  mimeType: "application/pdf",
  fileSize: 1024,
  status: "READY",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  processedAt: "2025-01-01T00:00:00.000Z",
};

function materialsResponse(materials: unknown[], nextCursor: string | null = null) {
  return new Response(JSON.stringify({ materials, nextCursor }), { status: 200 });
}

describe("useCourseMaterials.fetchMaterials", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not fetch when courseId is empty and stays loading", async () => {
    const { result } = renderHook(() => useCourseMaterials(""));

    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it("loads the first page on mount and exposes hasMore from nextCursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], "cursor-2"));

    const { result } = renderHook(() => useCourseMaterials("course-1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.materials).toEqual([material]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/courses/course-1/materials");
  });

  it("hasMore is false once the server returns a null cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], null));

    const { result } = renderHook(() => useCourseMaterials("course-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it("surfaces the server error text and clears loading on a failed initial fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Not found", { status: 404 }));

    const { result } = renderHook(() => useCourseMaterials("course-1"));

    await waitFor(() => expect(result.current.error).toBe("Not found"));
    expect(result.current.loading).toBe(false);
    expect(result.current.materials).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce("offline");

    const { result } = renderHook(() => useCourseMaterials("course-1"));

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch materials"));
  });

  it("refetch reloads the list via the exposed refetch alias", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(materialsResponse([]));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.materials).toHaveLength(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.materials).toEqual([]);
  });
});

describe("useCourseMaterials.loadMore", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("appends the next page and updates the cursor", async () => {
    const material2 = { ...material, id: "mat-2" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material], "cursor-2"))
      .mockResolvedValueOnce(materialsResponse([material2], null));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetch).toHaveBeenNthCalledWith(2, "/api/courses/course-1/materials?cursor=cursor-2");
    expect(result.current.materials).toEqual([material, material2]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
  });

  it("is a no-op when there is no next cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], null));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sets an error and clears loadingMore when the next page fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material], "cursor-2"))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe("server error");
    expect(result.current.loadingMore).toBe(false);
    // The already-loaded page is left in place.
    expect(result.current.materials).toEqual([material]);
  });
});

// The pre-#949 synchronous upload tests that lived here (a 201 resolving to the
// created row, and a 413 whose raw body text was rethrown) are gone with the
// contract they pinned: the POST now returns 202 and every outcome comes from
// polling. Their replacements — request shape, both rejection shapes, and each
// `UploadOutcome` branch — are in the `#949 async contract` block below, which
// drives fake timers instead of waiting out real poll intervals.

describe("useCourseMaterials.deleteMaterial", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("DELETEs the material and refetches the list", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(materialsResponse([]));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.materials).toHaveLength(1);

    await act(async () => {
      await result.current.deleteMaterial("mat-1");
    });

    expect(fetch).toHaveBeenNthCalledWith(2, "/api/courses/course-1/materials/mat-1", {
      method: "DELETE",
    });
    await waitFor(() => expect(result.current.materials).toEqual([]));
  });

  it("throws the API error body and leaves the list untouched", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.deleteMaterial("mat-1")).rejects.toThrow("Forbidden");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.materials).toHaveLength(1);
  });
});

/**
 * #949: the POST only returns 202 + a materialId; every real outcome is
 * resolved by polling the list until the row leaves PROCESSING. These drive the
 * clock directly so a 1.5s poll interval does not cost 1.5s of wall time.
 */
describe("useCourseMaterials.uploadMaterial (#949 async contract)", () => {
  const POLL_MS = 1500;
  const TIMEOUT_MS = 5 * 60 * 1000;

  const processing = { ...material, id: "mat-new", status: "PROCESSING", processedAt: null };
  const file = new File(["slides"], "week2.pdf", { type: "application/pdf" });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Mount and settle the initial list read. */
  async function mount(initial: unknown[] = []) {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse(initial));
    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    return result;
  }

  /** Start an upload and drive the clock far enough for `polls` poll rounds. */
  async function upload(result: { current: ReturnType<typeof useCourseMaterials> }, polls = 1) {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.uploadMaterial(file);
      await vi.advanceTimersByTimeAsync(0); // POST + the immediate refetch
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * polls);
    });
    return pending;
  }

  const accepted = () => new Response(JSON.stringify({ materialId: "mat-new" }), { status: 202 });

  it("posts multipart form data and resolves ready once the row settles", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing])) // immediate repaint
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: "READY" }]));

    expect(await upload(result)).toEqual({
      status: "ready",
      materialId: "mat-new",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/courses/course-1/materials");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("paints the PROCESSING row before the outcome is known", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValue(materialsResponse([processing]));

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.uploadMaterial(file);
      await vi.advanceTimersByTimeAsync(0);
    });

    // The POST has returned 202 but nothing has settled yet.
    expect(result.current.materials).toEqual([processing]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
    });
    await expect(pending).resolves.toEqual({ status: "processing", materialId: "mat-new" });
  });

  it("reports a late duplicate and deletes the receipt row", async () => {
    const result = await mount();
    const receipt = { ...processing, status: "FAILED", duplicateOfId: "mat-1" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // receipt cleanup
      .mockResolvedValueOnce(materialsResponse([])); // refetch after delete

    expect(await upload(result)).toEqual({
      status: "duplicate",
      materialId: "mat-new",
      duplicateOfId: "mat-1",
    });

    expect(fetch).toHaveBeenCalledWith("/api/courses/course-1/materials/mat-new", {
      method: "DELETE",
    });
  });

  it("still reports the duplicate when receipt cleanup fails", async () => {
    const result = await mount();
    const receipt = { ...processing, status: "FAILED", duplicateOfId: "mat-1" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 })); // cleanup denied

    expect(await upload(result)).toEqual({
      status: "duplicate",
      materialId: "mat-new",
      duplicateOfId: "mat-1",
    });
  });

  it("reports failed for a FAILED row with no duplicate pointer", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: "FAILED" }]));

    expect(await upload(result)).toEqual({
      status: "failed",
      materialId: "mat-new",
      // Null covers rows that failed before the column existed (#1791); the UI
      // falls back to the old generic sentence for those.
      failureCode: null,
    });
  });

  it("carries the failure reason so the UI can name it (#1791)", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(
        materialsResponse([
          { ...processing, status: "FAILED", failureCode: "MATERIAL_EMBED_RATE_LIMITED" },
        ]),
      );

    expect(await upload(result)).toEqual({
      status: "failed",
      materialId: "mat-new",
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    });
  });

  it("reports a restored material as a success, not as 'already exists' (#1791)", async () => {
    // Re-uploading a file whose processing failed retries it, and the receipt
    // says so. Calling that a duplicate is what left the instructor in a loop:
    // the retry worked and was still reported as a refusal.
    const result = await mount();
    const receipt = {
      ...processing,
      status: "FAILED",
      duplicateOfId: "mat-1",
      duplicateResolution: "RESTORED",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // receipt cleanup
      .mockResolvedValueOnce(materialsResponse([])); // post-cleanup refresh

    expect(await upload(result)).toEqual({
      status: "restored",
      materialId: "mat-new",
      duplicateOfId: "mat-1",
    });
  });

  it("reports a receipt carrying a reason as failed, not duplicate (#1791)", async () => {
    // A restore whose embedding died. The receipt still points at the material
    // it tried to revive — that row holds the real failure — but reporting it as
    // a duplicate told the instructor the file was already there while the only
    // copy of it sat FAILED, with the receipt then deleted.
    const result = await mount();
    const receipt = {
      ...processing,
      status: "FAILED",
      duplicateOfId: "mat-1",
      duplicateResolution: "RESTORED",
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // receipt cleanup
      .mockResolvedValueOnce(materialsResponse([])); // post-cleanup refresh

    expect(await upload(result)).toEqual({
      status: "failed",
      materialId: "mat-new",
      failureCode: "MATERIAL_EMBED_RATE_LIMITED",
    });
  });

  it("stops watching when the row is no longer on page 1", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([])); // row gone (deleted elsewhere)

    expect(await upload(result)).toEqual({
      status: "processing",
      materialId: "mat-new",
    });
  });

  it("keeps polling through a transient list-read failure", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: "READY" }]));

    expect(await upload(result, 2)).toEqual({
      status: "ready",
      materialId: "mat-new",
    });
  });

  it("gives up as processing once the poll deadline passes", async () => {
    const result = await mount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValue(materialsResponse([processing])); // never settles

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.uploadMaterial(file);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
    });

    await expect(pending).resolves.toEqual({ status: "processing", materialId: "mat-new" });
  });

  it("throws the API error field when the POST is rejected", async () => {
    const result = await mount();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "FILE_TOO_LARGE" }), { status: 400 }),
    );

    await expect(result.current.uploadMaterial(file)).rejects.toThrow("FILE_TOO_LARGE");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    const result = await mount();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

    await expect(result.current.uploadMaterial(file)).rejects.toThrow("Upload failed (502)");
  });

  it("merges a polled row in place without dropping later pages", async () => {
    // `loadMore` pulled page 2; a poll only re-reads page 1, so the merge must
    // update the watched row and leave the rest of the list alone.
    const page2 = { ...material, id: "mat-old" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ materials: [processing], nextCursor: "c1" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ materials: [page2], nextCursor: null }), { status: 200 }),
      );

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.materials.map((m) => m.id)).toEqual(["mat-new", "mat-old"]);

    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: "READY" }]));

    expect(await upload(result)).toEqual({
      status: "ready",
      materialId: "mat-new",
    });
    expect(result.current.materials.find((m) => m.id === "mat-new")?.status).toBe("READY");
  });
});

describe("useCourseMaterials background refresh (#1494 review)", () => {
  const REFRESH_MS = 30 * 1000;
  const processing = { ...material, id: "mat-slow", status: "PROCESSING", processedAt: null };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(initial: unknown[]) {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse(initial));
    const { result, unmount } = renderHook(() => useCourseMaterials("course-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return { result, unmount };
  }

  it("keeps re-reading the list while a row is still PROCESSING", async () => {
    // `watchUpload` has given up (or the user reloaded onto a mid-flight row),
    // but the UI still promises the list will update when processing finishes.
    const { result } = await mount([processing]);
    expect(result.current.materials[0].status).toBe("PROCESSING");

    vi.mocked(fetch).mockResolvedValue(materialsResponse([{ ...processing, status: "READY" }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });

    expect(result.current.materials[0].status).toBe("READY");
  });

  it("does not poll when nothing is PROCESSING, and stops once the row settles", async () => {
    const { result } = await mount([material]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    // Only the initial list read — an all-settled list must not poll at all.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.materials[0].status).toBe("READY");
  });

  it("leaves the list untouched when a background read fails", async () => {
    const { result } = await mount([processing]);
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });

    // A transient failure behind a list the user can already see is not worth
    // surfacing; the next tick retries.
    expect(result.current.materials[0].status).toBe("PROCESSING");
    expect(result.current.error).toBeNull();
  });

  it("clears the interval on unmount", async () => {
    const { unmount } = await mount([processing]);
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });
});

/**
 * #1795 review round 3. Retry is the first case where a row can go PROCESSING
 * while sitting past page 1 — uploads are newest-first, so a new row is always
 * on page 1. Reloading page 1 after the 202 threw away every page the user had
 * loaded with "load more", taking the retried row off screen with it.
 */
describe("useCourseMaterials.reprocessMaterial past page 1", () => {
  const REFRESH_MS = 30 * 1000;
  const page1Row = { ...material, id: "mat-new" };
  const failed = {
    ...material,
    id: "mat-old",
    status: "FAILED",
    processedAt: null,
    hasExtractedText: true,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function accepted() {
    return new Response(JSON.stringify({ materialId: "mat-old", status: "PROCESSING" }), {
      status: 202,
    });
  }

  /** The failed row is on page 2, which is where an older failure actually lives. */
  async function mountTwoPages() {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([page1Row], "cursor-2"))
      .mockResolvedValueOnce(materialsResponse([failed], null));
    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.materials.map((m) => m.id)).toEqual(["mat-new", "mat-old"]);
    return result;
  }

  it("keeps the pages already loaded when a retry is accepted", async () => {
    const result = await mountTwoPages();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      // What a page-1 reload would answer — the retried row is not in it.
      .mockResolvedValue(materialsResponse([page1Row], "cursor-2"));

    await act(async () => {
      await result.current.reprocessMaterial("mat-old");
    });

    expect(result.current.materials.map((m) => m.id)).toEqual(["mat-new", "mat-old"]);
  });

  it("returns the retried row to PROCESSING in place, without reloading the list", async () => {
    const result = await mountTwoPages();
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValue(materialsResponse([page1Row], "cursor-2"));

    await act(async () => {
      await result.current.reprocessMaterial("mat-old");
    });

    const row = result.current.materials.find((m) => m.id === "mat-old");
    expect(row?.status).toBe("PROCESSING");
    // The failure affordances go with the failure: the popover must not keep
    // offering "Try again" for a retry that is already running.
    expect(row?.hasExtractedText).toBeUndefined();
    // No skeleton flash over a list the user is already looking at.
    expect(result.current.loading).toBe(false);
  });

  it("settles a PROCESSING row past page 1 by re-reading it by id", async () => {
    const result = await mountTwoPages();
    vi.mocked(fetch).mockResolvedValueOnce(accepted());
    await act(async () => {
      await result.current.reprocessMaterial("mat-old");
    });

    // Page 1 never mentions mat-old, so a page-1-only poll can never settle it.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes("ids=")
          ? materialsResponse([{ ...failed, status: "READY", hasExtractedText: undefined }])
          : materialsResponse([page1Row], "cursor-2"),
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });

    expect(result.current.materials.find((m) => m.id === "mat-old")?.status).toBe("READY");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("ids=mat-old"))).toBe(
      true,
    );
  });

  it("asks for no id read when page 1 already covers every PROCESSING row", async () => {
    // The upload case, which is every case before this change: an extra request
    // per tick for rows the page-1 read already refreshed would be pure waste.
    vi.mocked(fetch).mockResolvedValueOnce(
      materialsResponse([{ ...page1Row, status: "PROCESSING", processedAt: null }], null),
    );
    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    vi.mocked(fetch).mockResolvedValue(
      materialsResponse([{ ...page1Row, status: "PROCESSING", processedAt: null }], null),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS);
    });

    expect(result.current.materials[0].status).toBe("PROCESSING");
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("ids="))).toBe(true);
  });
});
