/**
 * Unit tests for `CoursesUnitAdminView` (#1546): unit-scoped course list for
 * unit admins — the "no authorized units" warning, the unit filter (only shown
 * with >1 unit), and the unit-driven empty hint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CoursesUnitAdminView } from "@/components/courses/courses-unit-admin-view";
import type { Course } from "@/types/question";

let userValue: any = { id: "1", role: "unit-admin", authorizedUnits: [] };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: userValue }),
}));

vi.mock("@/hooks/useCanvasLinks", () => ({ useCanvasLinks: () => new Set<number>() }));
vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({ canManageCanvas: false }),
}));

afterEach(() => {
  cleanup();
  userValue = { id: "1", role: "unit-admin", authorizedUnits: [] };
});

describe("CoursesUnitAdminView", () => {
  it('shows the "no authorized units" warning when the user has none', () => {
    render(
      <MemoryRouter>
        <CoursesUnitAdminView courses={[]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No authorized units are assigned");
  });

  it("does not show the warning when the user has authorized units", () => {
    userValue = { id: "1", role: "unit-admin", authorizedUnits: ["CPSC"] };
    render(
      <MemoryRouter>
        <CoursesUnitAdminView courses={[]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("writes the unit name out in the subheading for a single unit and hides the unit select", () => {
    userValue = { id: "1", role: "unit-admin", authorizedUnits: ["COSC"] };
    const course = { id: 1, name: "Intro to CS", code: "COSC 101", department: "COSC" } as Course;
    render(
      <MemoryRouter>
        <CoursesUnitAdminView courses={[course]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Courses in Computer Science that you can author."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Unit" })).toBeNull();
  });

  it("shows a Unit select with full unit names when the user has more than one unit", () => {
    userValue = { id: "1", role: "unit-admin", authorizedUnits: ["COSC", "MATH"] };
    const course = { id: 1, name: "Intro to CS", code: "COSC 101", department: "COSC" } as Course;
    render(
      <MemoryRouter>
        <CoursesUnitAdminView courses={[course]} isLoading={false} />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox", { name: "Unit" });
    fireEvent.click(select);
    expect(screen.getByRole("option", { name: "Computer Science" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mathematics" })).toBeInTheDocument();
  });

  it("renders courses passed through to the grid", () => {
    const course = { id: 1, name: "Intro to CS", code: "CPSC 101", department: "CPSC" } as Course;
    userValue = { id: "1", role: "unit-admin", authorizedUnits: ["CPSC"] };
    render(
      <MemoryRouter>
        <CoursesUnitAdminView courses={[course]} isLoading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/CPSC 101/)).toBeInTheDocument();
  });
});
