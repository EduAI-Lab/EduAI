/**
 * Unit tests for useDisciplines (§541) — the DB-backed discipline registry
 * hook that replaced the hardcoded UNIT_OPTIONS / UNIT_LABELS.
 *
 * Covers the success path (options/getLabel derivation), the retry-then-
 * succeed path, the retry-exhausted error path (with the non-Error
 * fallback message), and the manual `refetch` trigger.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDisciplines } from "~/hooks/api/use-disciplines";

const disciplines = [
  { code: "CPSC", name: "Computer Science" },
  { code: "MATH", name: "Mathematics" },
];

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDisciplines", () => {
  it("loads disciplines and derives options + getLabel", async () => {
    mockFetch.mockResolvedValue(okJson({ disciplines }));

    const { result } = renderHook(() => useDisciplines());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.disciplines).toEqual(disciplines);
    expect(result.current.options).toEqual([
      { code: "CPSC", label: "Computer Science" },
      { code: "MATH", label: "Mathematics" },
    ]);
    expect(result.current.getLabel("MATH")).toBe("Mathematics");
    // Unknown codes fall back to the code itself.
    expect(result.current.getLabel("UNKNOWN")).toBe("UNKNOWN");
    expect(result.current.error).toBeNull();
  });

  it("defaults to an empty list when the response has no disciplines field", async () => {
    mockFetch.mockResolvedValue(okJson({}));

    const { result } = renderHook(() => useDisciplines());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.disciplines).toEqual([]);
    expect(result.current.options).toEqual([]);
  });

  it("retries a transient failure and succeeds without surfacing an error", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockRejectedValueOnce(new Error("network blip"))
        .mockResolvedValueOnce(okJson({ disciplines }));

      const { result } = renderHook(() => useDisciplines());

      // First attempt fails, hook schedules a retry after 500ms.
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      await vi.waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.disciplines).toEqual(disciplines);
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces an error message after all retry attempts are exhausted", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockRejectedValue(new Error("server down"));

      const { result } = renderHook(() => useDisciplines());

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      await vi.waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe("server down");
      expect(result.current.disciplines).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a generic message when the thrown value is not an Error", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockRejectedValue("socket hangup");

      const { result } = renderHook(() => useDisciplines());

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      await vi.waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe("Failed to fetch disciplines");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetch triggers another request", async () => {
    mockFetch.mockResolvedValue(okJson({ disciplines }));

    const { result } = renderHook(() => useDisciplines());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mockFetch.mock.calls.length;

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(before));
  });
});
