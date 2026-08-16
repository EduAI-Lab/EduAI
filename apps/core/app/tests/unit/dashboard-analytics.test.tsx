/**
 * Unit tests for `DashboardAnalytics` — the presentational analytics row
 * (materials donut, user-roles donut, weekly-activity meter). No existing
 * test file covers this component yet.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStats } from "~/types/dashboard";

const baseStats: DashboardStats = {
  chatCount: 0,
  chatCountWeek: 0,
  materialCount: 0,
  studentCount: 0,
  instructorCount: 0,
  totalUsers: 0,
  activeCourseCount: 0,
};

describe("DashboardAnalytics", () => {
  it("renders a skeleton and nothing else while loading", () => {
    const { container } = render(<DashboardAnalytics stats={null} loading />);

    expect(container.querySelectorAll(".animate-pulse").length).toBe(3);
    expect(screen.queryByText("AI activity")).not.toBeInTheDocument();
  });

  it("renders nothing when stats is null and not loading", () => {
    const { container } = render(<DashboardAnalytics stats={null} />);

    expect(container.firstChild).toBeNull();
  });

  it("always renders the AI activity panel from stats present", () => {
    render(<DashboardAnalytics stats={baseStats} />);

    expect(screen.getByText("AI activity")).toBeInTheDocument();
    expect(screen.getByText("No conversations recorded yet.")).toBeInTheDocument();
  });

  it("reports weekly vs. total chat counts when activity exists", () => {
    render(
      <DashboardAnalytics
        stats={{ ...baseStats, chatCount: 20, chatCountWeek: 6 }}
      />,
    );

    expect(screen.getByText("6 of 20 total conversations happened in the last 7 days.")).toBeInTheDocument();
  });

  it("hides the materials panel when materialsByStatus is absent", () => {
    render(<DashboardAnalytics stats={baseStats} />);

    expect(screen.queryByText("Material status")).not.toBeInTheDocument();
  });

  it("shows the materials empty state when materialsByStatus totals zero", () => {
    render(
      <DashboardAnalytics
        stats={{ ...baseStats, materialsByStatus: { ready: 0, processing: 0, failed: 0 } }}
      />,
    );

    expect(screen.getByText("Material status")).toBeInTheDocument();
    expect(screen.getByText("No materials uploaded yet.")).toBeInTheDocument();
  });

  it("renders the materials donut with a total when materialsByStatus has data", () => {
    render(
      <DashboardAnalytics
        stats={{ ...baseStats, materialsByStatus: { ready: 5, processing: 2, failed: 1 } }}
      />,
    );

    expect(screen.getByText("Material status")).toBeInTheDocument();
    expect(screen.queryByText("No materials uploaded yet.")).not.toBeInTheDocument();
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("hides the user-roles panel when usersByRole is absent", () => {
    render(<DashboardAnalytics stats={baseStats} />);

    expect(screen.queryByText("Users by role")).not.toBeInTheDocument();
  });

  it("shows the users empty state when usersByRole totals zero", () => {
    render(
      <DashboardAnalytics
        stats={{
          ...baseStats,
          usersByRole: { students: 0, instructors: 0, admins: 0, other: 0 },
        }}
      />,
    );

    expect(screen.getByText("Users by role")).toBeInTheDocument();
    expect(screen.getByText("No users yet.")).toBeInTheDocument();
  });

  it("renders the users donut with a total when usersByRole has data", () => {
    render(
      <DashboardAnalytics
        stats={{
          ...baseStats,
          usersByRole: { students: 10, instructors: 2, admins: 1, other: 0 },
        }}
      />,
    );

    expect(screen.getByText("Users by role")).toBeInTheDocument();
    expect(screen.queryByText("No users yet.")).not.toBeInTheDocument();
  });

  it("uses a single-column layout when only the activity panel renders", () => {
    const { container } = render(<DashboardAnalytics stats={baseStats} />);

    expect(container.firstElementChild).toHaveClass("md:grid-cols-1");
  });

  it("uses a two-column layout when two panels render", () => {
    const { container } = render(
      <DashboardAnalytics
        stats={{ ...baseStats, materialsByStatus: { ready: 1, processing: 0, failed: 0 } }}
      />,
    );

    expect(container.firstElementChild).toHaveClass("md:grid-cols-2");
  });

  it("uses a three-column layout when all three panels render", () => {
    const { container } = render(
      <DashboardAnalytics
        stats={{
          ...baseStats,
          materialsByStatus: { ready: 1, processing: 0, failed: 0 },
          usersByRole: { students: 1, instructors: 0, admins: 0, other: 0 },
        }}
      />,
    );

    expect(container.firstElementChild).toHaveClass("md:grid-cols-3");
  });
});
