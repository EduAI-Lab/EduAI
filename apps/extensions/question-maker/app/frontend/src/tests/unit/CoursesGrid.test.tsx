/**
 * Unit tests for `CoursesGrid` (#1546, #2119): QM's wrapper over the shared
 * `@eduai/ui` CourseListView with Canvas-style cards, a table view, a Status
 * filter and the card/list toggle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CoursesGrid } from "@/components/courses/CoursesGrid";
import type { Course } from "@/types/question";

const { linkedIds } = vi.hoisted(() => ({ linkedIds: { current: new Set<number>() } }));
const { canvasSpy } = vi.hoisted(() => ({ canvasSpy: vi.fn() }));
vi.mock("@/hooks/useCanvasLinks", () => ({
  useCanvasLinks: (ids: number[], enabled: boolean) => {
    canvasSpy(ids, enabled);
    return linkedIds.current;
  },
}));
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({ canManageCanvas: true }),
}));

beforeEach(() => {
  linkedIds.current = new Set();
  canvasSpy.mockClear();
  window.localStorage.clear();
});
afterEach(() => cleanup());

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    name: "Intro to CS",
    code: "CPSC 101",
    term: "Fall",
    year: 2025,
    ...overrides,
  } as Course;
}

function renderGrid(props: Partial<Parameters<typeof CoursesGrid>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CoursesGrid courses={[makeCourse()]} isLoading={false} {...props} />
    </MemoryRouter>,
  );
}

describe("CoursesGrid", () => {
  it("renders each course as a link to /courses/:id with no tab", () => {
    renderGrid();
    const link = screen.getByRole("link", { name: /CPSC 101/ });
    expect(link).toHaveAttribute("href", "/courses/1");
  });

  it("shows the empty state (with a default hint) when there are no courses", () => {
    renderGrid({ courses: [] });
    expect(screen.getByText("No courses yet")).toBeInTheDocument();
  });

  it("shows a custom empty hint when provided", () => {
    renderGrid({ courses: [], emptyHint: "Ask an admin to enroll you." });
    expect(screen.getByText("Ask an admin to enroll you.")).toBeInTheDocument();
  });

  it("shows a loading skeleton instead of course cards while isLoading", () => {
    renderGrid({ isLoading: true });
    expect(screen.queryByText(/CPSC 101/)).toBeNull();
  });

  it("points the guided tour at the first course on screen, with its route (#1754)", () => {
    const courses = [
      makeCourse({ id: 42, code: "CPSC 121", term: "W2", year: 2025 }),
      makeCourse({ id: 43, code: "CPSC 101", term: "W1", year: 2026 }),
    ];
    renderGrid({ courses });
    const first = document.querySelector('[data-tour="course-select"]');
    expect(first).toHaveAttribute("data-course-id", "43");
    expect(first).toHaveAttribute("data-tour-route", "/courses/43");
  });

  it("tags the empty state so the tour can explain linking a course", () => {
    renderGrid({ courses: [] });
    expect(document.querySelector('[data-tour="qm-courses-empty"]')).toBeInTheDocument();
  });

  it("drops the old chips and description", () => {
    renderGrid({
      courses: [makeCourse({ coreCourseId: "c1", updatedAt: new Date().toISOString() })],
    });
    expect(screen.queryByText("EduAI Core")).toBeNull();
    expect(screen.queryByText(/Synced/)).toBeNull();
    expect(screen.queryByText("No description yet")).toBeNull();
  });

  it("puts the filter card class on the toolbar", () => {
    renderGrid();
    expect(document.querySelector(".shadow-xs.p-2\\.5")).toBeInTheDocument();
  });

  it("shows the status pill when statuses are mixed", () => {
    renderGrid({
      courses: [
        makeCourse({ id: 1, isPublished: true }),
        makeCourse({ id: 2, code: "CPSC 102", isPublished: false }),
      ],
    });
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unpublished").length).toBeGreaterThan(0);
  });

  it("switches to the table, with one header per term group and the row date", () => {
    renderGrid({ courses: [makeCourse({ updatedAt: "2025-03-04T12:00:00Z" })] });
    fireEvent.click(screen.getByRole("radio", { name: /list/i }));
    expect(screen.getAllByText("Last updated")).toHaveLength(1);
    expect(screen.getByText("Mar 4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Intro to CS" })).toHaveAttribute("href", "/courses/1");
  });

  it("puts the department label on the banner when showDepartment is set", () => {
    renderGrid({ courses: [makeCourse({ department: "COSC" as any })], showDepartment: true });
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
  });

  it("shows a Canvas shortcut only for a linked course", () => {
    linkedIds.current = new Set([1]);
    renderGrid({ courses: [makeCourse({ id: 1 }), makeCourse({ id: 2, code: "CPSC 102" })] });
    expect(screen.getAllByRole("link", { name: "Canvas" })).toHaveLength(1);
  });

  it("renders custom filters when provided", () => {
    renderGrid({ filters: <div>My Filter</div> });
    expect(screen.getByText("My Filter")).toBeInTheDocument();
  });

  it("applies a matchesFilter predicate to hide non-matching courses", () => {
    renderGrid({
      courses: [makeCourse({ id: 1 }), makeCourse({ id: 2, code: "HIDE ME" })],
      matchesFilter: (c) => c.id === 1,
    });
    expect(screen.getByText(/CPSC 101/)).toBeInTheDocument();
    expect(screen.queryByText(/HIDE ME/)).toBeNull();
  });

  it("looks up Canvas links in card view only", () => {
    renderGrid();
    expect(canvasSpy).toHaveBeenLastCalledWith([1], true);
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(canvasSpy).toHaveBeenLastCalledWith([1], false);
  });
});
