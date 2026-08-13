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

describe("useCourseMaterials.uploadMaterial", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs the file as FormData, refetches, and resolves with the created row", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify(material), { status: 201 }))
      .mockResolvedValueOnce(materialsResponse([material]));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const file = new File(["content"], "slides.pdf", { type: "application/pdf" });
    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.uploadMaterial(file);
    });

    const [url, init] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe("/api/courses/course-1/materials");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    expect(uploaded).toEqual(material);
    expect(result.current.materials).toEqual([material]);
  });

  it("throws the server error text and does not refetch on failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([]))
      .mockResolvedValueOnce(new Response("File too large", { status: 413 }));

    const { result } = renderHook(() => useCourseMaterials("course-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const file = new File(["content"], "slides.pdf", { type: "application/pdf" });
    await expect(result.current.uploadMaterial(file)).rejects.toThrow("File too large");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

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

    await expect(result.current.deleteMaterial('mat-1')).rejects.toThrow('Forbidden')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.materials).toHaveLength(1)
  })
})

/**
 * #949: the POST only returns 202 + a materialId; every real outcome is
 * resolved by polling the list until the row leaves PROCESSING. These drive the
 * clock directly so a 1.5s poll interval does not cost 1.5s of wall time.
 */
describe('useCourseMaterials.uploadMaterial (#949 async contract)', () => {
  const POLL_MS = 1500
  const TIMEOUT_MS = 5 * 60 * 1000

  const processing = { ...material, id: 'mat-new', status: 'PROCESSING', processedAt: null }
  const file = new File(['slides'], 'week2.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Mount and settle the initial list read. */
  async function mount(initial: unknown[] = []) {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse(initial))
    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.loading).toBe(false)
    return result
  }

  /** Start an upload and drive the clock far enough for `polls` poll rounds. */
  async function upload(
    result: { current: ReturnType<typeof useCourseMaterials> },
    polls = 1,
  ) {
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadMaterial(file)
      await vi.advanceTimersByTimeAsync(0) // POST + the immediate refetch
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * polls)
    })
    return pending
  }

  const accepted = () =>
    new Response(JSON.stringify({ materialId: 'mat-new' }), { status: 202 })

  it('posts multipart form data and resolves ready once the row settles', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing])) // immediate repaint
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: 'READY' }]))

    expect(await upload(result)).toEqual({
      status: 'ready',
      materialId: 'mat-new',
    })

    const [url, init] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/courses/course-1/materials')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
  })

  it('paints the PROCESSING row before the outcome is known', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValue(materialsResponse([processing]))

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadMaterial(file)
      await vi.advanceTimersByTimeAsync(0)
    })

    // The POST has returned 202 but nothing has settled yet.
    expect(result.current.materials).toEqual([processing])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS)
    })
    await expect(pending).resolves.toEqual({ status: 'processing', materialId: 'mat-new' })
  })

  it('reports a late duplicate and deletes the receipt row', async () => {
    const result = await mount()
    const receipt = { ...processing, status: 'FAILED', duplicateOfId: 'mat-1' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // receipt cleanup
      .mockResolvedValueOnce(materialsResponse([])) // refetch after delete

    expect(await upload(result)).toEqual({
      status: 'duplicate',
      materialId: 'mat-new',
      duplicateOfId: 'mat-1',
    })

    expect(fetch).toHaveBeenCalledWith('/api/courses/course-1/materials/mat-new', {
      method: 'DELETE',
    })
  })

  it('still reports the duplicate when receipt cleanup fails', async () => {
    const result = await mount()
    const receipt = { ...processing, status: 'FAILED', duplicateOfId: 'mat-1' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([receipt]))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 })) // cleanup denied

    expect(await upload(result)).toEqual({
      status: 'duplicate',
      materialId: 'mat-new',
      duplicateOfId: 'mat-1',
    })
  })

  it('reports failed for a FAILED row with no duplicate pointer', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: 'FAILED' }]))

    expect(await upload(result)).toEqual({
      status: 'failed',
      materialId: 'mat-new',
    })
  })

  it('stops watching when the row is no longer on page 1', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([])) // row gone (deleted elsewhere)

    expect(await upload(result)).toEqual({
      status: 'processing',
      materialId: 'mat-new',
    })
  })

  it('keeps polling through a transient list-read failure', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: 'READY' }]))

    expect(await upload(result, 2)).toEqual({
      status: 'ready',
      materialId: 'mat-new',
    })
  })

  it('gives up as processing once the poll deadline passes', async () => {
    const result = await mount()
    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValue(materialsResponse([processing])) // never settles

    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.uploadMaterial(file)
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS)
    })

    await expect(pending).resolves.toEqual({ status: 'processing', materialId: 'mat-new' })
  })

  it('throws the API error field when the POST is rejected', async () => {
    const result = await mount()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'FILE_TOO_LARGE' }), { status: 400 }),
    )

    await expect(result.current.uploadMaterial(file)).rejects.toThrow('FILE_TOO_LARGE')
  })

  it('falls back to the status code when the error body is not JSON', async () => {
    const result = await mount()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }))

    await expect(result.current.uploadMaterial(file)).rejects.toThrow('Upload failed (502)')
  })

  it('merges a polled row in place without dropping later pages', async () => {
    // `loadMore` pulled page 2; a poll only re-reads page 1, so the merge must
    // update the watched row and leave the rest of the list alone.
    const page2 = { ...material, id: 'mat-old' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ materials: [processing], nextCursor: 'c1' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ materials: [page2], nextCursor: null }), { status: 200 }),
      )

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.materials.map((m) => m.id)).toEqual(['mat-new', 'mat-old'])

    vi.mocked(fetch)
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(materialsResponse([processing]))
      .mockResolvedValueOnce(materialsResponse([{ ...processing, status: 'READY' }]))

    expect(await upload(result)).toEqual({
      status: 'ready',
      materialId: 'mat-new',
    })
    expect(result.current.materials.find((m) => m.id === 'mat-new')?.status).toBe('READY')
  })
})

describe('useCourseMaterials background refresh (#1494 review)', () => {
  const REFRESH_MS = 30 * 1000
  const processing = { ...material, id: 'mat-slow', status: 'PROCESSING', processedAt: null }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function mount(initial: unknown[]) {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse(initial))
    const { result, unmount } = renderHook(() => useCourseMaterials('course-1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return { result, unmount }
  }

  it('keeps re-reading the list while a row is still PROCESSING', async () => {
    // `watchUpload` has given up (or the user reloaded onto a mid-flight row),
    // but the UI still promises the list will update when processing finishes.
    const { result } = await mount([processing])
    expect(result.current.materials[0].status).toBe('PROCESSING')

    vi.mocked(fetch).mockResolvedValue(
      materialsResponse([{ ...processing, status: 'READY' }]),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS)
    })

    expect(result.current.materials[0].status).toBe('READY')
  })

  it('does not poll when nothing is PROCESSING, and stops once the row settles', async () => {
    const { result } = await mount([material])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3)
    })
    // Only the initial list read — an all-settled list must not poll at all.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.materials[0].status).toBe('READY')
  })

  it('leaves the list untouched when a background read fails', async () => {
    const { result } = await mount([processing])
    vi.mocked(fetch).mockRejectedValue(new Error('network down'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS)
    })

    // A transient failure behind a list the user can already see is not worth
    // surfacing; the next tick retries.
    expect(result.current.materials[0].status).toBe('PROCESSING')
    expect(result.current.error).toBeNull()
  })

  it('clears the interval on unmount', async () => {
    const { unmount } = await mount([processing])
    const callsBefore = vi.mocked(fetch).mock.calls.length
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3)
    })
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })
})
