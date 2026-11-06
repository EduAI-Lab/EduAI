/**
 * Unit tests for `QmDashboardView` (#2119): the props-driven Canvas-style
 * dashboard: sections, toggle, footer cap, side column and states.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QmDashboardView, type QmDashboardViewProps } from "@/components/dashboard/QmDashboardView";
import type { Course } from "@/types/question";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const course = (id: number, code: string): Course =>
  ({ id, code, name: `Name ${code}`, term: "W1", year: 2026 }) as Course;

function renderView(props: Partial<QmDashboardViewProps> = {}) {
  const defaults: QmDashboardViewProps = {
    heading: "Welcome back, Ada.",
    subheading: "Your courses and question writing.",
    sections: [{ key: "all", title: "", courses: [course(1, "CPSC 101")] }],
    courseTotal: 1,
    coursesLoading: false,
    sideLoading: false,
    attentionRows: [],
    stats: [{ label: "Questions", value: "10" }],
    linksFor: () => [],
  };
  return render(
    <MemoryRouter>
      <QmDashboardView {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe("QmDashboardView", () => {
  it("renders heading, subtitle, a single untitled section and linked cards", () => {
    renderView();
    expect(screen.getByText("Welcome back, Ada.")).toBeInTheDocument();
    expect(screen.getByText("Your courses and question writing.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: /\(\d+\)/ })).toBeNull();
    expect(screen.getByRole("link", { name: /CPSC 101/ })).toHaveAttribute("href", "/courses/1");
    expect(screen.queryByText("Quick actions")).toBeNull();
    expect(screen.queryByText("Recent activity")).toBeNull();
  });

  it("renders titled sections with counts when more than one is non-empty", () => {
    renderView({
      sections: [
        { key: "teach", title: "Courses you teach", courses: [course(1, "A 1")] },
        {
          key: "unit",
          title: "Courses in Computer Science",
          courses: [course(2, "B 2"), course(3, "C 3")],
        },
      ],
      courseTotal: 3,
    });
    expect(screen.getByRole("heading", { level: 3, name: "Courses you teach (1)" })).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Courses in Computer Science (2)" }),
    ).toBeVisible();
  });

  it("switches to the list table", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByText("Last updated")).toBeInTheDocument();
  });

  it("shows the truncation footer when only some courses are shown", () => {
    renderView({
      sections: [{ key: "all", title: "", courses: [course(1, "A 1"), course(2, "B 2")] }],
      courseTotal: 8,
    });
    expect(screen.getByTestId("truncated-list-notice")).toHaveTextContent("Showing 2 of 8 courses");
    expect(screen.getByRole("link", { name: /All 8 courses/ })).toHaveAttribute("href", "/courses");
  });

  it("renders attention rows as links and the drafts link", () => {
    renderView({
      attentionRows: [
        {
          key: "drafts",
          text: "3 variants waiting for review",
          actionLabel: "Review",
          href: "/library?status=draft",
          edgeColor: "var(--color-warning-500)",
        },
      ],
    });
    expect(
      screen.getByRole("link", { name: "Review: 3 variants waiting for review" }),
    ).toHaveAttribute("href", "/library?status=draft");
    expect(screen.getByRole("link", { name: /All drafts/ })).toHaveAttribute(
      "href",
      "/library?status=draft",
    );
  });

  it("shows the empty attention line", () => {
    renderView();
    expect(screen.getByText("Nothing needs attention right now.")).toBeInTheDocument();
  });

  it("renders stat detail text", () => {
    renderView({ stats: [{ label: "Reviewed variants", value: "22", detail: "of 5" }] });
    expect(screen.getByText("Reviewed variants")).toBeInTheDocument();
    expect(screen.getByText("of 5")).toBeInTheDocument();
  });

  it("shows skeletons and no cards while loading", () => {
    renderView({ coursesLoading: true, sideLoading: true, sections: [] });
    expect(screen.getAllByTestId("course-skeleton")).toHaveLength(3);
    expect(screen.getByTestId("attention-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /CPSC/ })).toBeNull();
  });

  it("shows the empty copy and a Courses link with no courses", () => {
    renderView({ sections: [], courseTotal: 0 });
    expect(screen.getByText(/You don't have any courses yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Courses/ })).toHaveAttribute("href", "/courses");
    expect(screen.getByText("At a glance")).toBeInTheDocument();
  });
});
