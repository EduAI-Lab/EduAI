/**
 * Unit tests for `CoursesRoleView` (#1546): the shared admin/instructor course
 * list view — role-driven heading/subheading/emptyHint/showDepartment config.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { CoursesRoleView } from "@/components/courses/courses-role-view";
import { QmLayoutProvider, useQmLayout } from "@/components/layout/QmLayoutContext";
import type { Course } from "@/types/question";

/** Cards are links, so every render needs a router. */
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function ProfileProbe() {
  return <span data-testid="profile-open">{String(useQmLayout().profileOpen)}</span>;
}

describe("CoursesRoleView", () => {
  it("renders the admin heading/subheading and empty hint", () => {
    render(<CoursesRoleView role="admin" courses={[]} isLoading={false} />);
    expect(screen.getByText("Courses")).toBeInTheDocument();
    expect(screen.getByText(/Every course you have access to/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open a course in EduAI Core and choose Question Maker to start authoring it.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the instructor subheading and empty hint", () => {
    render(<CoursesRoleView role="instructor" courses={[]} isLoading={false} />);
    expect(screen.getByText(/Shared courses are ones you co-teach/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Open a course in EduAI Core and choose Question Maker to start writing questions for it.",
      ),
    ).toBeInTheDocument();
  });

  it.each(["admin", "instructor"] as const)(
    "links the %s empty state to Core's course list",
    (role) => {
      vi.stubEnv("VITE_CORE_URL", "https://core.example.com");
      render(<CoursesRoleView role={role} courses={[]} isLoading={false} />);
      expect(screen.getByRole("link", { name: /Go to my courses in Core/ })).toHaveAttribute(
        "href",
        "https://core.example.com/courses",
      );
    },
  );

  it("hides Add course outside the layout, which owns the dialog", () => {
    render(<CoursesRoleView role="instructor" courses={[]} isLoading={false} />);
    expect(screen.queryByRole("button", { name: /Add course/ })).toBeNull();
  });

  it("opens the Add Courses dialog from the empty state", () => {
    render(
      <QmLayoutProvider>
        <CoursesRoleView role="instructor" courses={[]} isLoading={false} />
        <ProfileProbe />
      </QmLayoutProvider>,
    );
    expect(screen.getByTestId("profile-open")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: /Add course/ }));
    expect(screen.getByTestId("profile-open")).toHaveTextContent("true");
  });

  it("shows no empty-state CTA once there are courses", () => {
    const course = { id: 1, name: "Intro to CS", code: "CPSC 101" } as Course;
    render(<CoursesRoleView role="instructor" courses={[course]} isLoading={false} />);
    expect(screen.queryByRole("link", { name: /Go to my courses in Core/ })).toBeNull();
  });

  it("renders course cards passed through to the grid", () => {
    const course = { id: 1, name: "Intro to CS", code: "CPSC 101" } as Course;
    render(<CoursesRoleView role="admin" courses={[course]} isLoading={false} />);
    expect(screen.getByRole("heading", { name: /^CPSC 101 · / })).toBeInTheDocument();
  });

  it("gives instructors the dashboard's course card, linking to the course sections", () => {
    const course = { id: 7, name: "Intro to CS", code: "CPSC 101" } as Course;
    render(<CoursesRoleView role="instructor" courses={[course]} isLoading={false} />);
    expect(screen.getByRole("link", { name: "CPSC 101 · Intro to CS" })).toHaveAttribute(
      "href",
      "/courses/7?tab=overview",
    );
    const sections = screen.getByRole("navigation", { name: "CPSC 101 sections" });
    expect(
      within(sections)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/courses/7?tab=overview",
      "/courses/7?tab=questions",
      "/courses/7?tab=banks",
      "/courses/7?tab=assessments",
    ]);
    // Still the guided tour's first-card target (#1754).
    expect(document.querySelector('[data-tour="course-select"]')).toHaveAttribute(
      "data-tour-route",
      "/courses/7",
    );
  });
});
