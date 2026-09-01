/**
 * Unit tests for `useDisplayCourses` (#1546): merges local QM courses with
 * Core's enrollment list and filters via `filterCoursesForCourseSelection`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const useAuthMock = vi.fn();
const useCoursesMock = vi.fn();
const listCourses = vi.fn();
const filterCoursesForCourseSelection = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/useCourses", () => ({ useCourses: () => useCoursesMock() }));
vi.mock("@/services/eduaiService", () => ({
  eduaiService: { listCourses: (...args: unknown[]) => listCourses(...args) },
}));
vi.mock("@/utils/courseDisplay", () => ({
  filterCoursesForCourseSelection: (...args: unknown[]) => filterCoursesForCourseSelection(...args),
}));

import { useDisplayCourses } from "@/hooks/useDisplayCourses";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useDisplayCourses", () => {
  it("loads Core courses and passes them through the filter", async () => {
    useAuthMock.mockReturnValue({ user: { role: "INSTRUCTOR" } });
    useCoursesMock.mockReturnValue({
      courses: [{ id: 1, name: "Local" }],
      isLoading: false,
      fetchCourses: vi.fn(),
    });
    listCourses.mockResolvedValue([{ id: "core-1" }]);
    filterCoursesForCourseSelection.mockReturnValue({
      courses: [{ id: 1, name: "Local" }],
      showMockLabel: false,
    });

    const { result } = renderHook(() => useDisplayCourses());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(filterCoursesForCourseSelection).toHaveBeenCalledWith(
      [{ id: 1, name: "Local" }],
      [{ id: "core-1" }],
      { bypassCoreEnrollmentFilter: false },
    );
    expect(result.current.displayCourses).toEqual([{ id: 1, name: "Local" }]);
    expect(result.current.hasCoreCourses).toBe(true);
  });

  it("bypasses the enrollment filter for ADMIN users", async () => {
    useAuthMock.mockReturnValue({ user: { role: "ADMIN" } });
    useCoursesMock.mockReturnValue({ courses: [], isLoading: false, fetchCourses: vi.fn() });
    listCourses.mockResolvedValue([]);
    filterCoursesForCourseSelection.mockReturnValue({ courses: [], showMockLabel: false });

    renderHook(() => useDisplayCourses());

    await waitFor(() =>
      expect(filterCoursesForCourseSelection).toHaveBeenCalledWith([], [], {
        bypassCoreEnrollmentFilter: true,
      }),
    );
  });

  it("falls back to an empty Core course list when the fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useAuthMock.mockReturnValue({ user: null });
    useCoursesMock.mockReturnValue({ courses: [], isLoading: false, fetchCourses: vi.fn() });
    listCourses.mockRejectedValue(new Error("down"));
    filterCoursesForCourseSelection.mockReturnValue({ courses: [], showMockLabel: true });

    const { result } = renderHook(() => useDisplayCourses());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasCoreCourses).toBe(false);
    expect(result.current.showMockLabel).toBe(true);
  });

  it("stays loading while the underlying course list is loading", () => {
    useAuthMock.mockReturnValue({ user: null });
    useCoursesMock.mockReturnValue({ courses: [], isLoading: true, fetchCourses: vi.fn() });
    listCourses.mockResolvedValue([]);
    filterCoursesForCourseSelection.mockReturnValue({ courses: [], showMockLabel: false });

    const { result } = renderHook(() => useDisplayCourses());
    expect(result.current.isLoading).toBe(true);
  });
});
