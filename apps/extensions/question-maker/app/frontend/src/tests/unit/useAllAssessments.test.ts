/**
 * Unit tests for `useAllAssessments` (#1546): fetch-on-mount over
 * `assessmentService.getAssessments`, scoped by an optional courseId.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getAssessments = vi.fn();

vi.mock("@/services/assessmentService", () => ({
  assessmentService: { getAssessments: (...args: unknown[]) => getAssessments(...args) },
}));

import { useAllAssessments } from "@/hooks/useAllAssessments";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAllAssessments", () => {
  it("fetches all assessments on mount with no courseId", async () => {
    getAssessments.mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useAllAssessments());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getAssessments).toHaveBeenCalledWith({ courseId: undefined });
    expect(result.current.assessments).toEqual([{ id: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it("scopes the fetch to a courseId when provided", async () => {
    getAssessments.mockResolvedValue([]);
    renderHook(() => useAllAssessments({ courseId: 42 }));
    await waitFor(() => expect(getAssessments).toHaveBeenCalledWith({ courseId: 42 }));
  });

  it("falls back to an empty array for a non-array response", async () => {
    getAssessments.mockResolvedValue(null);
    const { result } = renderHook(() => useAllAssessments());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.assessments).toEqual([]);
  });

  it("sets a server error message on failure", async () => {
    getAssessments.mockRejectedValue({ response: { data: { error: "denied" } } });
    const { result } = renderHook(() => useAllAssessments());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("denied");
  });

  it("falls back to a generic error message", async () => {
    getAssessments.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useAllAssessments());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch assessments");
  });

  it("refetch re-runs the fetch", async () => {
    getAssessments.mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useAllAssessments());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    getAssessments.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.assessments).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
