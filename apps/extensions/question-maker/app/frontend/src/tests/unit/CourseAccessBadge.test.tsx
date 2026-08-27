/**
 * Unit tests for `CourseAccessBadge` (#1546): renders access/relationship
 * badges based on role view, using the real (already-tested)
 * `lib/rbac/course-labels` helpers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseAccessBadge } from "@/components/courses/CourseAccessBadge";
import type { Course } from "@/types/question";

afterEach(() => cleanup());

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    name: "Intro to CS",
    code: "CPSC 101",
    userId: "owner-1",
    accessLevel: "admin",
    ...overrides,
  } as Course;
}

describe("CourseAccessBadge", () => {
  it("renders nothing for a role view with no applicable badges", () => {
    const { container } = render(<CourseAccessBadge course={makeCourse()} roleView={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the access-level badge for an admin role view", () => {
    render(<CourseAccessBadge course={makeCourse({ accessLevel: "admin" })} roleView="admin" />);
    expect(screen.getByText("Admin access")).toBeInTheDocument();
  });

  it("shows the unit-scope badge for a unit-admin role view", () => {
    render(
      <CourseAccessBadge course={makeCourse({ accessLevel: "unit" })} roleView="unit-admin" />,
    );
    expect(screen.getByText("Unit scope")).toBeInTheDocument();
  });

  it("does not show an access badge when the course has no accessLevel", () => {
    render(<CourseAccessBadge course={makeCourse({ accessLevel: undefined })} roleView="admin" />);
    expect(screen.queryByText(/access/)).toBeNull();
  });

  it('shows "Your course" for an instructor viewing their own course', () => {
    render(
      <CourseAccessBadge
        course={makeCourse({ userId: "me" })}
        roleView="instructor"
        currentUserId="me"
      />,
    );
    expect(screen.getByText("Your course")).toBeInTheDocument();
  });

  it('shows "Shared course" for an instructor viewing another user\'s course', () => {
    render(
      <CourseAccessBadge
        course={makeCourse({ userId: "other" })}
        roleView="instructor"
        currentUserId="me"
      />,
    );
    expect(screen.getByText("Shared course")).toBeInTheDocument();
  });

  it("does not show a relationship badge without a currentUserId", () => {
    render(<CourseAccessBadge course={makeCourse()} roleView="instructor" />);
    expect(screen.queryByText(/course$/)).toBeNull();
  });

  it("can show both badges together for an admin who owns the course", () => {
    render(
      <CourseAccessBadge
        course={makeCourse({ userId: "me", accessLevel: "admin" })}
        roleView="admin"
        currentUserId="me"
      />,
    );
    expect(screen.getByText("Admin access")).toBeInTheDocument();
  });
});
