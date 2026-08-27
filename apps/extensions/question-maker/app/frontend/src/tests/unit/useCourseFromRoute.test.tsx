/**
 * Unit tests for `useCourseFromRoute` (#1546): resolves the course for
 * `:courseId` in the URL against the accessible display-courses list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const useParamsMock = vi.fn();
const useDisplayCoursesMock = vi.fn();

vi.mock("react-router", () => ({ useParams: () => useParamsMock() }));
vi.mock("@/hooks/useDisplayCourses", () => ({ useDisplayCourses: () => useDisplayCoursesMock() }));

import { useCourseFromRoute } from "@/hooks/useCourseFromRoute";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCourseFromRoute", () => {
  it("returns notFound when there is no courseId param", () => {
    useParamsMock.mockReturnValue({});
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: false });

    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current).toEqual({ course: null, courseId: null, isLoading: false, notFound: true });
  });

  it("returns notFound for a non-numeric or non-positive courseId", () => {
    useParamsMock.mockReturnValue({ courseId: "abc" });
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: false });
    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current.notFound).toBe(true);
    expect(result.current.courseId).toBeNull();
  });

  it("returns notFound for courseId 0 or negative", () => {
    useParamsMock.mockReturnValue({ courseId: "0" });
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: false });
    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current.notFound).toBe(true);
  });

  it("reports loading while display courses are loading", () => {
    useParamsMock.mockReturnValue({ courseId: "5" });
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: true });
    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current).toEqual({ course: null, courseId: 5, isLoading: true, notFound: false });
  });

  it("returns notFound once loaded when the course isn't in the accessible list", () => {
    useParamsMock.mockReturnValue({ courseId: "5" });
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [{ id: 6 }], isLoading: false });
    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current).toEqual({ course: null, courseId: 5, isLoading: false, notFound: true });
  });

  it("returns the course when found", () => {
    const course = { id: 5, name: "Course 5" };
    useParamsMock.mockReturnValue({ courseId: "5" });
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [course], isLoading: false });
    const { result } = renderHook(() => useCourseFromRoute());
    expect(result.current).toEqual({ course, courseId: 5, isLoading: false, notFound: false });
  });
});
