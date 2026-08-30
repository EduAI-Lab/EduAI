/**
 * Unit tests for `useQuestionStats` (#1546): fetch-on-mount over
 * `questionService.getQuestionStats`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getQuestionStats = vi.fn();

vi.mock("@/services/questionService", () => ({
  questionService: { getQuestionStats: (...args: unknown[]) => getQuestionStats(...args) },
}));

import { useQuestionStats } from "@/hooks/useQuestionStats";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useQuestionStats", () => {
  it("fetches stats on mount", async () => {
    getQuestionStats.mockResolvedValue({ total: 10 });
    const { result } = renderHook(() => useQuestionStats());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stats).toEqual({ total: 10 });
    expect(result.current.error).toBeNull();
  });

  it("sets a server error message on failure", async () => {
    getQuestionStats.mockRejectedValue({ response: { data: { error: "boom" } } });
    const { result } = renderHook(() => useQuestionStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.stats).toBeNull();
  });

  it("falls back to a generic error message", async () => {
    getQuestionStats.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useQuestionStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch question stats");
  });

  it("refetch re-runs the fetch", async () => {
    getQuestionStats.mockResolvedValue({ total: 1 });
    const { result } = renderHook(() => useQuestionStats());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    getQuestionStats.mockResolvedValue({ total: 2 });
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.stats).toEqual({ total: 2 });
  });
});
