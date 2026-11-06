/**
 * Unit tests for `CoursesRoleView` (#1546): the shared admin/instructor course
 * list view — role-driven heading/subheading/emptyHint/showDepartment config.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { CoursesRoleView } from "@/components/courses/courses-role-view";
import type { Course } from "@/types/question";

vi.mock("@/hooks/useCanvasLinks", () => ({ useCanvasLinks: () => new Set<number>() }));
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({ canManageCanvas: false }),
}));

afterEach(() => cleanup());

describe("CoursesRoleView", () => {
  it("renders the admin heading/subheading and empty hint", () => {
    render(
      <MemoryRouter>
        <CoursesRoleView role="admin" courses={[]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Courses")).toBeInTheDocument();
    expect(screen.getByText("Browse every course and manage its questions.")).toBeInTheDocument();
    expect(
      screen.getByText("No courses linked yet. Add a course to start authoring."),
    ).toBeInTheDocument();
  });

  it("renders the instructor subheading and empty hint", () => {
    render(
      <MemoryRouter>
        <CoursesRoleView role="instructor" courses={[]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Courses you teach, including ones you co-teach.")).toBeInTheDocument();
    expect(
      screen.getByText("No courses yet. Add a course from your profile to get started."),
    ).toBeInTheDocument();
  });

  it("renders course cards passed through to the grid", () => {
    const course = { id: 1, name: "Intro to CS", code: "CPSC 101" } as Course;
    render(
      <MemoryRouter>
        <CoursesRoleView role="admin" courses={[course]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/CPSC 101/)).toBeInTheDocument();
  });
});
