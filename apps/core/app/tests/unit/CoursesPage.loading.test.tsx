import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The shared shell pulls in sidebar/site-header hooks; stub them so the page
// under test isn't coupled to the app chrome.
vi.mock("~/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("~/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// CoursesView is stubbed with a stable marker so the assertion is about the
// *page* gating: when `loading` is true but courses already exist, the page
// must keep CoursesView mounted rather than swapping in "Loading courses...".
vi.mock("~/components/courses/courses-view", () => ({
  CoursesView: () => <div data-testid="courses-view" />,
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: () => ({
      user: { id: "u1", role: "ADMIN", name: "Admin", email: "a@test.com" },
      authorizedUnits: [],
      taCourseIds: [],
      instructorCourseIds: [],
      enrolledCourseIds: [],
      instructors: [],
    }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

const state = vi.hoisted(() => ({
  loading: false,
  courses: [] as unknown[],
}));

vi.mock("~/hooks/api/use-courses", () => ({
  useCourses: () => ({
    courses: state.courses,
    total: state.courses.length,
    pagination: { pageIndex: 0, pageSize: 25 },
    setPagination: vi.fn(),
    loading: state.loading,
    search: "",
    setSearch: vi.fn(),
    selectedFilters: { status: [], term: [], department: [] },
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
    availableValues: {},
    error: null,
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
  }),
}));

import CoursesPage from "~/routes/courses";

const COURSE = {
  id: "c1",
  code: "COSC 101",
  name: "Intro to CS",
  description: null,
  term: "Fall",
  year: 2025,
  isActive: true,
  isPublished: true,
  aiInstructions: "",
  instructorId: null,
  department: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CoursesPage />
    </MemoryRouter>,
  );
}

describe("CoursesPage — loading gate", () => {
  beforeEach(() => {
    state.loading = false;
    state.courses = [];
  });

  it("shows the full-page loader on the genuine initial load (no rows yet)", () => {
    state.loading = true;
    state.courses = [];

    renderPage();

    expect(screen.getByText("Loading courses...")).toBeInTheDocument();
    expect(screen.queryByTestId("courses-view")).not.toBeInTheDocument();
  });

  it("keeps the loaded page mounted when a background refresh flips loading on", () => {
    state.loading = false;
    state.courses = [COURSE];

    const { rerender } = renderPage();
    expect(screen.getByTestId("courses-view")).toBeInTheDocument();

    // A mutation-triggered refetch must not tear the page down: `loading` is
    // true while rows already exist, so the loader is skipped.
    state.loading = true;
    rerender(
      <MemoryRouter>
        <CoursesPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Loading courses...")).not.toBeInTheDocument();
    expect(screen.getByTestId("courses-view")).toBeInTheDocument();
  });

  it("renders the courses view once the initial load resolves", () => {
    state.loading = false;
    state.courses = [COURSE];

    renderPage();

    expect(screen.queryByText("Loading courses...")).not.toBeInTheDocument();
    expect(screen.getByTestId("courses-view")).toBeInTheDocument();
  });
});
