/**
 * Unit tests for `CoursesGrid` (#1546): QM's thin wrapper over the shared
 * `@eduai/ui` CourseListView — the dashboard's course card, empty state, and
 * the loading skeleton branch.
 */
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import { CoursesGrid } from "@/components/courses/CoursesGrid";
import type { Course } from "@/types/question";

/** Cards are links, so every render needs a router. */
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

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

describe("CoursesGrid", () => {
  it("renders a course card for each course", () => {
    render(<CoursesGrid courses={[makeCourse()]} isLoading={false} />);
    expect(screen.getByRole("heading", { name: /^CPSC 101 · / })).toBeInTheDocument();
  });

  it("links the card to the course overview and its sections", () => {
    render(<CoursesGrid courses={[makeCourse({ id: 7 })]} isLoading={false} />);
    expect(screen.getByRole("link", { name: "CPSC 101 · Intro to CS" })).toHaveAttribute(
      "href",
      "/courses/7?tab=overview",
    );
    const sections = screen.getByRole("navigation", { name: "CPSC 101 sections" });
    expect(within(sections).getAllByRole("link")).toHaveLength(4);
  });

  it("shows the empty state (with a default hint) when there are no courses", () => {
    render(<CoursesGrid courses={[]} isLoading={false} />);
    expect(screen.getByText("No courses yet")).toBeInTheDocument();
  });

  it("shows a custom empty hint when provided", () => {
    render(<CoursesGrid courses={[]} isLoading={false} emptyHint="Ask an admin to enroll you." />);
    expect(screen.getByText("Ask an admin to enroll you.")).toBeInTheDocument();
  });

  it("shows a loading skeleton instead of course cards while isLoading", () => {
    render(<CoursesGrid courses={[makeCourse()]} isLoading />);
    expect(screen.queryByRole("heading", { name: /^CPSC 101 · / })).toBeNull();
  });

  it("points the guided tour at the first course on screen, with its route (#1754)", () => {
    // The data lists an older term first, but the list shows newer terms
    // first, so the tour must pick the first card in display order.
    const courses = [
      makeCourse({ id: 42, code: "CPSC 121", term: "W2", year: 2025 }),
      makeCourse({ id: 43, code: "CPSC 101", term: "W1", year: 2026 }),
    ];
    render(<CoursesGrid courses={courses} isLoading={false} />);
    const first = document.querySelector('[data-tour="course-select"]');
    expect(first).toHaveAttribute("data-course-id", "43");
    expect(first).toHaveAttribute("data-tour-route", "/courses/43");
  });

  it("tags the empty state so the tour can explain linking a course", () => {
    render(<CoursesGrid courses={[]} isLoading={false} />);
    expect(document.querySelector('[data-tour="qm-courses-empty"]')).toBeInTheDocument();
  });
});

describe("CoursesGrid additional coverage", () => {
  it('shows the "EduAI Core" badge for a linked course and "Local" for an unlinked one', () => {
    const linked = makeCourse({ id: 1, coreCourseId: "core-1" });
    const local = makeCourse({ id: 2, code: "LOCAL 1", coreCourseId: null });
    render(<CoursesGrid courses={[linked, local]} isLoading={false} />);
    expect(screen.getByText("EduAI Core")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it('shows a "Synced today" badge for a very recent updatedAt', () => {
    const course = makeCourse({ updatedAt: new Date().toISOString() });
    render(<CoursesGrid courses={[course]} isLoading={false} />);
    expect(screen.getByText("Synced today")).toBeInTheDocument();
  });

  it('shows a "Synced yesterday" badge for a ~1 day old updatedAt', () => {
    const course = makeCourse({
      updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    });
    render(<CoursesGrid courses={[course]} isLoading={false} />);
    expect(screen.getByText("Synced yesterday")).toBeInTheDocument();
  });

  it('shows a "Synced Nd ago" badge for a few days old updatedAt', () => {
    const course = makeCourse({
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(<CoursesGrid courses={[course]} isLoading={false} />);
    expect(screen.getByText("Synced 3d ago")).toBeInTheDocument();
  });

  it("omits a synced badge for a course with no/invalid updatedAt", () => {
    const course = makeCourse({ updatedAt: undefined });
    render(<CoursesGrid courses={[course]} isLoading={false} />);
    expect(screen.queryByText(/Synced/)).toBeNull();
  });

  it("renders a department badge when showDepartment is set", () => {
    const course = makeCourse({ department: "MATH" as any });
    render(<CoursesGrid courses={[course]} isLoading={false} showDepartment />);
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
  });

  it("renders custom filters when provided", () => {
    render(
      <CoursesGrid courses={[makeCourse()]} isLoading={false} filters={<div>My Filter</div>} />,
    );
    expect(screen.getByText("My Filter")).toBeInTheDocument();
  });

  it("applies a matchesFilter predicate to hide non-matching courses", () => {
    const courses = [makeCourse({ id: 1 }), makeCourse({ id: 2, code: "HIDE ME" })];
    render(<CoursesGrid courses={courses} isLoading={false} matchesFilter={(c) => c.id === 1} />);
    expect(screen.getByRole("heading", { name: /^CPSC 101 · / })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^HIDE ME · / })).toBeNull();
  });
});
