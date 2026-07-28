/**
 * Unit tests for the server-paginated course hook (#1041).
 *
 * `/api/courses` requires `page`/`pageSize`, so there is no "give me every
 * course" mode any more: callers that need an aggregate read `total` rather
 * than counting rows. These tests cover the paths the migration added — the
 * offset reset on a new search, the failure branch (a 400 PAGINATION_REQUIRED
 * body must surface as an error, not an empty list), and the refetch-after-
 * mutation calls that keep the page and `total` honest.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCourses } from "~/hooks/api/use-courses";

const course = { id: "course-1", name: "Intro", code: "CS101" };

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function page(data: unknown[] = [course], total = data.length) {
  return okJson({ data, total, page: 1, pageSize: 25 });
}

function listUrls(mockFetch: ReturnType<typeof vi.fn>) {
  return mockFetch.mock.calls
    .map((c) => String(c[0]))
    .filter((url) => url.startsWith("/api/courses?"));
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(page());
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCourses", () => {
  it("requests the first page with paging params and exposes the server total", async () => {
    mockFetch.mockResolvedValue(page([course], 512));

    const { result } = renderHook(() => useCourses());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.courses).toEqual([course]);
    // 512 total rows behind a 25-row page — counting `courses` would report 1.
    expect(result.current.total).toBe(512);
    expect(listUrls(mockFetch)[0]).toContain("page=1");
    expect(listUrls(mockFetch)[0]).toContain("pageSize=25");
  });

  it("passes isActive through as a query param when supplied", async () => {
    const { result } = renderHook(() => useCourses({ isActive: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listUrls(mockFetch)[0]).toContain("isActive=false");
  });

  it("surfaces a failed list read as an error instead of silently emptying the table", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("PAGINATION_REQUIRED"),
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const { result } = renderHook(() => useCourses());

    await waitFor(() => expect(result.current.error).toBe("PAGINATION_REQUIRED"));
    expect(result.current.loading).toBe(false);
    expect(result.current.courses).toEqual([]);
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    mockFetch.mockRejectedValue("socket hangup");

    const { result } = renderHook(() => useCourses());

    await waitFor(() => expect(result.current.error).toBe("Failed to fetch courses"));
  });

  it("does not reset the offset on the first render", async () => {
    const { result } = renderHook(() => useCourses());

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPagination({ pageIndex: 3, pageSize: 25 }));

    await waitFor(() => expect(listUrls(mockFetch).some((u) => u.includes("page=4"))).toBe(true));
    // The debounce effect's first pass must not stomp the offset back to 0.
    expect(result.current.pagination.pageIndex).toBe(3);
  });

  it("resets the offset once a new search lands, so page 4 of the old query isn't requested", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCourses());
      await vi.waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setPagination({ pageIndex: 3, pageSize: 25 }));
      await vi.waitFor(() => expect(result.current.pagination.pageIndex).toBe(3));

      act(() => result.current.setSearch("algebra"));
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await vi.waitFor(() => expect(result.current.pagination.pageIndex).toBe(0));
      await vi.waitFor(() =>
        expect(listUrls(mockFetch).some((u) => u.includes("search=algebra"))).toBe(true),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches when another view broadcasts eduai:courses-changed", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = listUrls(mockFetch).length;

    await act(async () => {
      window.dispatchEvent(new Event("eduai:courses-changed"));
    });

    await waitFor(() => expect(listUrls(mockFetch).length).toBeGreaterThan(before));
  });

  it("createCourse POSTs FormData then refetches, since the new row's page depends on the sort", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = listUrls(mockFetch).length;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? okJson(course) : page()),
    );

    let created: unknown;
    await act(async () => {
      created = await result.current.createCourse({
        name: "Intro",
        code: "CS101",
        section: "A",
        term: "Fall",
        year: 2026,
        startDate: "2026-09-01",
        instructorUserIds: ["u1"],
      } as never);
    });

    expect(created).toEqual(course);
    const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(post?.[0]).toBe("/api/courses");
    expect((post?.[1] as RequestInit).body).toBeInstanceOf(FormData);
    expect(listUrls(mockFetch).length).toBeGreaterThan(before);
  });

  it("createCourse throws the server message on failure", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST"
          ? ({ ok: false, status: 422, text: () => Promise.resolve("duplicate code") } as unknown as Response)
          : page(),
      ),
    );

    await expect(
      result.current.createCourse({
        name: "Intro",
        code: "CS101",
        section: "A",
        term: "Fall",
        year: 2026,
        startDate: "2026-09-01",
        instructorUserIds: [],
      } as never),
    ).rejects.toThrow("duplicate code");
  });

  it("updateCourse patches the loaded row in place without a refetch", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = listUrls(mockFetch).length;
    const updated = { ...course, name: "Renamed" };
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PATCH" ? okJson(updated) : page()),
    );

    await act(async () => {
      await result.current.updateCourse("course-1", { name: "Renamed" } as never);
    });

    expect(result.current.courses).toEqual([updated]);
    // An in-place edit can't move the row between pages, so no refetch.
    expect(listUrls(mockFetch).length).toBe(before);
  });

  it("deleteCourse refetches, because removing a row pulls the next page's first row in", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = listUrls(mockFetch).length;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "DELETE"
          ? ({ ok: true, status: 204, text: () => Promise.resolve("") } as unknown as Response)
          : page(),
      ),
    );

    await act(async () => {
      await result.current.deleteCourse("course-1");
    });

    expect(listUrls(mockFetch).length).toBeGreaterThan(before);
  });

  it("deleteCourse throws the server message on failure", async () => {
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "DELETE"
          ? ({ ok: false, status: 409, text: () => Promise.resolve("course has enrollments") } as unknown as Response)
          : page(),
      ),
    );

    await expect(result.current.deleteCourse("course-1")).rejects.toThrow("course has enrollments");
  });
});
