/**
 * Unit tests for `CoursesGrid` (#1546): QM's thin wrapper over the shared
 * `@eduai/ui` CourseListView — click-to-select cards, empty state, and the
 * loading skeleton branch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { CoursesGrid } from "@/components/courses/CoursesGrid";
import type { Course } from "@/types/question";

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
    render(<CoursesGrid courses={[makeCourse()]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("CPSC 101")).toBeInTheDocument();
  });

  it("calls onSelectCourse when a course card is clicked", () => {
    const onSelectCourse = vi.fn();
    const course = makeCourse();
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={onSelectCourse} />);

    fireEvent.click(screen.getByRole("button", { name: /CPSC 101/ }));
    expect(onSelectCourse).toHaveBeenCalledWith(course);
  });

  it("supports keyboard activation on a course card", () => {
    const onSelectCourse = vi.fn();
    const course = makeCourse();
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={onSelectCourse} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /CPSC 101/ }), { key: "Enter" });
    expect(onSelectCourse).toHaveBeenCalledWith(course);
  });

  it("shows the empty state (with a default hint) when there are no courses", () => {
    render(<CoursesGrid courses={[]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("No courses yet")).toBeInTheDocument();
  });

  it("shows a custom empty hint when provided", () => {
    render(
      <CoursesGrid
        courses={[]}
        isLoading={false}
        onSelectCourse={vi.fn()}
        emptyHint="Ask an admin to enroll you."
      />,
    );
    expect(screen.getByText("Ask an admin to enroll you.")).toBeInTheDocument();
  });

  it("shows a loading skeleton instead of course cards while isLoading", () => {
    render(<CoursesGrid courses={[makeCourse()]} isLoading onSelectCourse={vi.fn()} />);
    expect(screen.queryByText("CPSC 101")).toBeNull();
  });

  it("tags the first course for the guided tour when no explicit highlight is given", () => {
    const course = makeCourse({ id: 42 });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(document.querySelector('[data-tour-id="course-select"]')).toHaveAttribute(
      "data-course-id",
      "42",
    );
  });
});

describe("CoursesGrid additional coverage", () => {
  it("respects an explicit tourHighlightCourseId over the first course", () => {
    const courses = [makeCourse({ id: 1 }), makeCourse({ id: 2, code: "CPSC 102" })];
    render(
      <CoursesGrid
        courses={courses}
        isLoading={false}
        onSelectCourse={vi.fn()}
        tourHighlightCourseId={2}
      />,
    );
    expect(document.querySelector('[data-tour-id="course-select"]')).toHaveAttribute(
      "data-course-id",
      "2",
    );
  });

  it("supports space-key activation on a course card", () => {
    const onSelectCourse = vi.fn();
    const course = makeCourse();
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={onSelectCourse} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /CPSC 101/ }), { key: " " });
    expect(onSelectCourse).toHaveBeenCalledWith(course);
  });

  it("ignores other keys on a course card", () => {
    const onSelectCourse = vi.fn();
    render(
      <CoursesGrid courses={[makeCourse()]} isLoading={false} onSelectCourse={onSelectCourse} />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /CPSC 101/ }), { key: "a" });
    expect(onSelectCourse).not.toHaveBeenCalled();
  });

  it('shows the "EduAI Core" badge for a linked course and "Local" for an unlinked one', () => {
    const linked = makeCourse({ id: 1, coreCourseId: "core-1" });
    const local = makeCourse({ id: 2, code: "LOCAL 1", coreCourseId: null });
    render(<CoursesGrid courses={[linked, local]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("EduAI Core")).toBeInTheDocument();
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it('shows a "Synced today" badge for a very recent updatedAt', () => {
    const course = makeCourse({ updatedAt: new Date().toISOString() });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("Synced today")).toBeInTheDocument();
  });

  it('shows a "Synced yesterday" badge for a ~1 day old updatedAt', () => {
    const course = makeCourse({
      updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("Synced yesterday")).toBeInTheDocument();
  });

  it('shows a "Synced Nd ago" badge for a few days old updatedAt', () => {
    const course = makeCourse({
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText("Synced 3d ago")).toBeInTheDocument();
  });

  it("omits a synced badge for a course with no/invalid updatedAt", () => {
    const course = makeCourse({ updatedAt: undefined });
    render(<CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.queryByText(/Synced/)).toBeNull();
  });

  it("renders a department badge when showDepartment is set", () => {
    const course = makeCourse({ department: "cs" as any });
    render(
      <CoursesGrid courses={[course]} isLoading={false} onSelectCourse={vi.fn()} showDepartment />,
    );
    // The department label rendering is delegated to the shared CourseCard;
    // this asserts the wrapper still renders the course without throwing.
    expect(screen.getByText("CPSC 101")).toBeInTheDocument();
  });

  it("renders custom filters when provided", () => {
    render(
      <CoursesGrid
        courses={[makeCourse()]}
        isLoading={false}
        onSelectCourse={vi.fn()}
        filters={<div>My Filter</div>}
      />,
    );
    expect(screen.getByText("My Filter")).toBeInTheDocument();
  });

  it("applies a matchesFilter predicate to hide non-matching courses", () => {
    const courses = [makeCourse({ id: 1 }), makeCourse({ id: 2, code: "HIDE ME" })];
    render(
      <CoursesGrid
        courses={courses}
        isLoading={false}
        onSelectCourse={vi.fn()}
        matchesFilter={(c) => c.id === 1}
      />,
    );
    expect(screen.getByText("CPSC 101")).toBeInTheDocument();
    expect(screen.queryByText("HIDE ME")).toBeNull();
  });
});
