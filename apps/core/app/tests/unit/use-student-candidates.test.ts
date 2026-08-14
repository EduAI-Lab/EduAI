/**
 * Unit tests for the debounced "add student" / "add TA" search-select backend.
 *
 * Covers: the `courseId` guard, the debounced search request (query params and
 * the 250ms debounce), the error and thrown-fetch branches (both clear
 * candidates rather than surfacing an error to the caller), and the stale-
 * request guard that drops a slow response once a newer keystroke has fired.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudentCandidates } from "~/hooks/api/use-student-candidates";

const candidate = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(okJson({ data: [candidate] }));
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useStudentCandidates", () => {
  it("does not fetch when courseId is undefined", async () => {
    renderHook(() => useStudentCandidates(undefined, "enrolled"));

    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches candidates for the course after the debounce, with exclude/role/isActive params", async () => {
    vi.useFakeTimers();
    renderHook(() => useStudentCandidates("course-1", "enrolled"));

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/users?");
    expect(url).toContain("courseId=course-1");
    expect(url).toContain("exclude=enrolled");
    expect(url).toContain("role=STUDENT");
    expect(url).toContain("isActive=true");
    expect(url).not.toContain("search=");
  });

  it("includes a trimmed search param once search() is called, debounced", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStudentCandidates("course-1", "ta"));

    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    mockFetch.mockClear();

    act(() => result.current.search("  ada  "));
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("search=ada");
    expect(url).toContain("exclude=ta");
  });

  it("sets loading true while the request is in flight and false once resolved", async () => {
    let resolveFetch!: (r: Response) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() => useStudentCandidates("course-1", "enrolled"));

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveFetch(okJson({ data: [candidate] }));
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates).toEqual([candidate]);
  });

  it("clears candidates (without throwing) when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server exploded"),
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const { result } = renderHook(() => useStudentCandidates("course-1", "enrolled"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates).toEqual([]);
  });

  it("clears candidates when fetch throws", async () => {
    mockFetch.mockRejectedValue(new TypeError("network down"));

    const { result } = renderHook(() => useStudentCandidates("course-1", "enrolled"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates).toEqual([]);
  });

  it("drops a stale response when a newer search has already started", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (r: Response) => void;
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(okJson({ data: [{ id: "u2", name: "Grace Hopper", email: "grace@example.com" }] }));
    });

    const { result } = renderHook(() => useStudentCandidates("course-1", "enrolled"));
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(callCount).toBe(1);

    // Fire a newer search before the first request resolves.
    act(() => result.current.search("newer"));
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await vi.waitFor(() => expect(callCount).toBe(2));

    // Now let the stale first request resolve — it must not clobber the fresh result.
    await act(async () => {
      resolveFirst(okJson({ data: [candidate] }));
    });

    await vi.waitFor(() => expect(result.current.candidates).toEqual([
      { id: "u2", name: "Grace Hopper", email: "grace@example.com" },
    ]));
  });
});
