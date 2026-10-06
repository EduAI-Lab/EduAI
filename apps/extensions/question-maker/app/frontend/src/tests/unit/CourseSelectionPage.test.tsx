/**
 * Unit tests for CourseSelectionPage (#1544): role-based view selection and
 * the course-select handler. Child views and hooks are mocked so we exercise
 * only this page's own routing/dispatch logic. The guided tour itself is
 * covered by the shared engine's tests in `@eduai/ui`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { navigateMock, useAuthMock, useDisplayCoursesMock, useAutoStartTourMock } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    useAuthMock: vi.fn(),
    useDisplayCoursesMock: vi.fn(),
    useAutoStartTourMock: vi.fn(),
  }),
);

vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));
vi.mock("@eduai/ui", () => ({
  useAutoStartTour: (...args: unknown[]) => useAutoStartTourMock(...args),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/useDisplayCourses", () => ({ useDisplayCourses: () => useDisplayCoursesMock() }));

let lastAdminProps: any;
let lastUnitAdminProps: any;
vi.mock("@/components/courses/courses-role-view", () => ({
  CoursesRoleView: (props: any) => {
    lastAdminProps = props;
    return (
      <div>
        role-view:{props.role}
        {props.courses.map((c: any) => (
          <button key={c.id} onClick={() => props.onSelectCourse(c)}>
            select-{c.id}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock("@/components/courses/courses-unit-admin-view", () => ({
  CoursesUnitAdminView: (props: any) => {
    lastUnitAdminProps = props;
    return <div>unit-admin-view</div>;
  },
}));

import { CourseSelectionPage } from "@/pages/CourseSelectionPage";

afterEach(() => {
  cleanup();
});

function setup(role: string, courses: any[] = [{ id: 1, name: "Intro" }]) {
  useAuthMock.mockReturnValue({ user: { role } });
  useDisplayCoursesMock.mockReturnValue({ displayCourses: courses, isLoading: false });
}

describe("CourseSelectionPage", () => {
  it("renders CoursesRoleView with admin role for ADMIN users", () => {
    setup("ADMIN");
    render(<CourseSelectionPage />);
    expect(screen.getByText("role-view:admin")).toBeInTheDocument();
  });

  it("renders CoursesUnitAdminView for UNIT_ADMIN users", () => {
    setup("UNIT_ADMIN");
    render(<CourseSelectionPage />);
    expect(screen.getByText("unit-admin-view")).toBeInTheDocument();
  });

  it("renders CoursesRoleView with instructor role by default", () => {
    setup("INSTRUCTOR");
    render(<CourseSelectionPage />);
    expect(screen.getByText("role-view:instructor")).toBeInTheDocument();
  });

  it("navigates to the course overview tab when a course is selected", () => {
    setup("ADMIN", [{ id: 7, name: "Data" }]);
    render(<CourseSelectionPage />);
    fireEvent.click(screen.getByText("select-7"));
    expect(navigateMock).toHaveBeenCalledWith("/courses/7?tab=overview");
  });

  it("auto-starts the guided tour only once courses have loaded (#1754)", () => {
    setup("INSTRUCTOR", []);
    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: true });
    const { rerender } = render(<CourseSelectionPage />);
    expect(useAutoStartTourMock).toHaveBeenLastCalledWith("main", { enabled: false });

    useDisplayCoursesMock.mockReturnValue({ displayCourses: [], isLoading: false });
    rerender(<CourseSelectionPage />);
    expect(useAutoStartTourMock).toHaveBeenLastCalledWith("main", { enabled: true });
  });
});
