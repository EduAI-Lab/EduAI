/** Creating a course opens it with a success toast, on both the direct and duplicate paths (#2162). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { CreateCourseInput, DuplicateResolution } from "~/hooks/api/use-courses";

const { mockToast, mockNavigate, mockCreateCourse } = vi.hoisted(() => ({
  mockToast: { error: vi.fn(), success: vi.fn() },
  mockNavigate: vi.fn(),
  mockCreateCourse: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mockToast }));

type Captured = {
  onCreateCourse?: (data: CreateCourseInput) => Promise<void>;
  onResolve?: (resolution: DuplicateResolution) => Promise<void>;
};
const captured: Captured = {};

vi.mock("~/components/courses/courses-view", () => ({
  CoursesView: (props: { onCreateCourse: Captured["onCreateCourse"] }) => {
    captured.onCreateCourse = props.onCreateCourse;
    return null;
  },
}));
vi.mock("~/components/courses/duplicate-course-dialog", () => ({
  DuplicateCourseDialog: (props: { onResolve: Captured["onResolve"] }) => {
    captured.onResolve = props.onResolve;
    return null;
  },
}));
vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLoaderData: () => ({
      user: { id: "u1", role: "INSTRUCTOR", name: "Prof", email: "p@test.com" },
      authorizedUnits: [],
      taCourseIds: [],
      instructorCourseIds: [],
      enrolledCourseIds: [],
      instructors: [],
    }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/hooks/api/use-courses", async (importActual) => {
  const actual = await importActual<typeof import("~/hooks/api/use-courses")>();
  return {
    ...actual,
    useCourses: () => ({
      courses: [],
      total: 0,
      pagination: { pageIndex: 0, pageSize: 25 },
      setPagination: vi.fn(),
      loading: false,
      createCourse: mockCreateCourse,
      updateCourse: vi.fn(),
      deleteCourse: vi.fn(),
    }),
  };
});

import CoursesPage from "~/routes/courses";
import { CourseDuplicateError } from "~/hooks/api/use-courses";

const INPUT = {
  name: "Intro",
  code: "COSC 101",
  section: "001",
  term: "Fall",
  year: 2026,
  startDate: "2026-09-01",
  instructorUserIds: [],
} satisfies CreateCourseInput;

function renderPage() {
  render(
    <MemoryRouter>
      <CoursesPage />
    </MemoryRouter>,
  );
}

describe("CoursesPage — create course", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the new course with a toast", async () => {
    mockCreateCourse.mockResolvedValueOnce({ id: "new-1" });
    renderPage();
    await act(() => captured.onCreateCourse!(INPUT));
    expect(mockToast.success).toHaveBeenCalledWith("Course created.");
    expect(mockNavigate).toHaveBeenCalledWith("/courses/new-1");
  });

  it("stays on the list when creation fails", async () => {
    mockCreateCourse.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    await act(() => expect(captured.onCreateCourse!(INPUT)).rejects.toThrow("boom"));
    expect(mockToast.error).toHaveBeenCalledWith("boom");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each<[DuplicateResolution, string]>([
    [{ duplicateResolution: "create" }, "Course created."],
    [{ duplicateResolution: "restore", restoreCourseId: "old-1" }, "Course restored."],
  ])("opens the course after resolving a duplicate (%o)", async (resolution, message) => {
    mockCreateCourse
      .mockRejectedValueOnce(new CourseDuplicateError([], []))
      .mockResolvedValueOnce({ id: "dup-1" });
    renderPage();
    let pending!: Promise<void>;
    act(() => {
      pending = captured.onCreateCourse!(INPUT);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(() => captured.onResolve!(resolution));
    await pending;
    expect(mockCreateCourse).toHaveBeenLastCalledWith(INPUT, resolution);
    expect(mockToast.success).toHaveBeenCalledWith(message);
    expect(mockNavigate).toHaveBeenCalledWith("/courses/dup-1");
  });
});
