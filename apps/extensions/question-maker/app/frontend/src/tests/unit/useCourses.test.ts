/**
 * Unit tests for `useCourses` (#1546): fetch-on-mount plus CRUD helpers that
 * keep local state in sync with `courseService`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const getCourses = vi.fn();
const createCourse = vi.fn();
const updateCourse = vi.fn();
const deleteCourse = vi.fn();

vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourses: (...args: unknown[]) => getCourses(...args),
    createCourse: (...args: unknown[]) => createCourse(...args),
    updateCourse: (...args: unknown[]) => updateCourse(...args),
    deleteCourse: (...args: unknown[]) => deleteCourse(...args),
  },
}));

import { useCourses } from "@/hooks/useCourses";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCourses", () => {
  it("fetches courses on mount and exposes them once resolved", async () => {
    getCourses.mockResolvedValue([{ id: 1, name: "Course A" }]);

    const { result } = renderHook(() => useCourses());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.courses).toEqual([{ id: 1, name: "Course A" }]);
    expect(result.current.error).toBeNull();
  });

  it("falls back to an empty array when the server returns a non-array", async () => {
    getCourses.mockResolvedValue(null);
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.courses).toEqual([]);
  });

  it("sets an error message when fetchCourses fails", async () => {
    getCourses.mockRejectedValue({ response: { data: { error: "boom" } } });
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.courses).toEqual([]);
  });

  it("falls back to a generic error message when none is provided", async () => {
    getCourses.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch courses");
  });

  it("createCourse prepends the new course on success", async () => {
    getCourses.mockResolvedValue([{ id: 1, name: "Existing" }]);
    createCourse.mockResolvedValue({ id: 2, name: "New Course" });

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.createCourse({ name: "New Course" } as any);
    });

    expect(response).toEqual({ success: true, data: { id: 2, name: "New Course" } });
    expect(result.current.courses[0]).toEqual({ id: 2, name: "New Course" });
    expect(result.current.courses).toHaveLength(2);
  });

  it("createCourse returns a failure result without mutating state on error", async () => {
    getCourses.mockResolvedValue([]);
    createCourse.mockRejectedValue({ response: { data: { error: "name taken" } } });

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.createCourse({ name: "Dup" } as any);
    });

    expect(response).toEqual({ success: false, error: "name taken" });
    expect(result.current.courses).toEqual([]);
  });

  it("updateCourse replaces the matching course on success", async () => {
    getCourses.mockResolvedValue([{ id: 1, name: "Old" }]);
    updateCourse.mockResolvedValue({ id: 1, name: "Updated" });

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.updateCourse(1, { name: "Updated" });
    });

    expect(response.success).toBe(true);
    expect(result.current.courses).toEqual([{ id: 1, name: "Updated" }]);
  });

  it("updateCourse returns a failure result on error", async () => {
    getCourses.mockResolvedValue([{ id: 1, name: "Old" }]);
    updateCourse.mockRejectedValue({ response: { data: { error: "not found" } } });

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.updateCourse(1, { name: "x" });
    });
    expect(response).toEqual({ success: false, error: "not found" });
  });

  it("deleteCourse removes the course from state on success", async () => {
    getCourses.mockResolvedValue([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    deleteCourse.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.deleteCourse(1);
    });

    expect(response).toEqual({ success: true });
    expect(result.current.courses).toEqual([{ id: 2, name: "B" }]);
  });

  it("deleteCourse returns a failure result without mutating state on error", async () => {
    getCourses.mockResolvedValue([{ id: 1, name: "A" }]);
    deleteCourse.mockRejectedValue({ response: { data: { error: "in use" } } });

    const { result } = renderHook(() => useCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let response: any;
    await act(async () => {
      response = await result.current.deleteCourse(1);
    });

    expect(response).toEqual({ success: false, error: "in use" });
    expect(result.current.courses).toEqual([{ id: 1, name: "A" }]);
  });
});
