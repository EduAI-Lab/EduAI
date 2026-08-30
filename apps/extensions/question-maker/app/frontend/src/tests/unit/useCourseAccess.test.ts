/**
 * Unit tests for `useCourseAccess` (#1546): resolves per-course access level
 * for UI gating, skipping the request for an absent/invalid courseId.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getCourseAccess = vi.fn();

vi.mock("@/services/courseService", () => ({
  courseService: { getCourseAccess: (...args: unknown[]) => getCourseAccess(...args) },
}));

import { useCourseAccess } from "@/hooks/useCourseAccess";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCourseAccess", () => {
  it("resolves access for a valid courseId", async () => {
    getCourseAccess.mockResolvedValue("instructor");
    const { result } = renderHook(() => useCourseAccess(5));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getCourseAccess).toHaveBeenCalledWith(5);
    expect(result.current.access).toBe("instructor");
  });

  it.each([null, undefined, 0, -1, NaN])(
    "skips the fetch for invalid courseId %s",
    async (courseId) => {
      const { result } = renderHook(() => useCourseAccess(courseId as any));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(getCourseAccess).not.toHaveBeenCalled();
      expect(result.current.access).toBeNull();
    },
  );

  it("sets access to null when the request fails", async () => {
    getCourseAccess.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useCourseAccess(5));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.access).toBeNull();
  });

  it("refresh re-runs the fetch", async () => {
    getCourseAccess.mockResolvedValue("ta");
    const { result } = renderHook(() => useCourseAccess(5));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    getCourseAccess.mockResolvedValue("admin");
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.access).toBe("admin");
  });

  it("re-fetches when courseId changes", async () => {
    getCourseAccess.mockResolvedValue("ta");
    const { result, rerender } = renderHook(({ id }) => useCourseAccess(id), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    getCourseAccess.mockResolvedValue("unit");
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.access).toBe("unit"));
    expect(getCourseAccess).toHaveBeenCalledWith(2);
  });
});
