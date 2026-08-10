/**
 * Unit tests for the per-role dashboard config (#1041).
 *
 * The counts on these dashboards used to come from `array.length` on a
 * full-list read. Under required paging the lists are one page, so ADMIN and
 * UNIT_ADMIN instead take `pageSize: 1` reads and display `stats.total` / the
 * envelope's `total`. Each `statBuilder` renders a server total (and an em dash,
 * not a misleading 0, while loading — which never happens under SSR but the
 * fallback is kept). The reads themselves now happen in the route's SSR loader;
 * their per-role gating is pinned in `dashboard-data.server.test.ts`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import {
  DASHBOARD_CONFIG,
  DashboardBody,
} from "~/components/dashboard/dashboard-view-config";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";

const baseCtx = {
  courses: [],
  coursesLoading: false,
  courseTotal: 0,
  stats: undefined,
  statsLoading: false,
  userTotal: 0,
  usersLoading: false,
  activeCourseTotal: 0,
  activeCoursesLoading: false,
};

const statsFor = (role: keyof typeof DASHBOARD_CONFIG, ctx: Partial<typeof baseCtx>) =>
  Object.fromEntries(
    DASHBOARD_CONFIG[role]
      .statBuilder({ ...baseCtx, ...ctx } as never)
      .map((s) => [s.label, s.value]),
  );

describe("DASHBOARD_CONFIG statBuilders", () => {
  it("ADMIN shows the platform user total and the active-course total from the server", () => {
    const stats = statsFor("ADMIN", {
      userTotal: 512,
      activeCourseTotal: 48,
      stats: { chatCount: 90, materialCount: 12 } as never,
    });

    expect(stats["Total users"]).toBe("512");
    expect(stats["Active courses"]).toBe("48");
    expect(stats["AI sessions"]).toBe("90");
    expect(stats["Materials uploaded"]).toBe("12");
  });

  it("ADMIN shows an em dash while each total is still loading, not a misleading 0", () => {
    const stats = statsFor("ADMIN", {
      usersLoading: true,
      activeCoursesLoading: true,
      statsLoading: true,
    });

    expect(stats["Total users"]).toBe("—");
    expect(stats["Active courses"]).toBe("—");
    expect(stats["AI sessions"]).toBe("—");
  });

  it("ADMIN falls back to 0 when a total is absent rather than rendering undefined", () => {
    const stats = statsFor("ADMIN", { userTotal: undefined, activeCourseTotal: undefined });

    expect(stats["Total users"]).toBe("0");
    expect(stats["Active courses"]).toBe("0");
  });

  it("UNIT_ADMIN reports unit and active course totals", () => {
    const stats = statsFor("UNIT_ADMIN", {
      courseTotal: 7,
      activeCourseTotal: 5,
      stats: { instructorCount: 3, chatCount: 20 } as never,
    });

    expect(stats["Unit courses"]).toBe("7");
    expect(stats["Active courses"]).toBe("5");
    expect(stats["Instructors"]).toBe("3");
  });

  it("UNIT_ADMIN shows em dashes while loading", () => {
    const stats = statsFor("UNIT_ADMIN", { coursesLoading: true, activeCoursesLoading: true });

    expect(stats["Unit courses"]).toBe("—");
    expect(stats["Active courses"]).toBe("—");
  });

  it("INSTRUCTOR reports its course total from the server count", () => {
    const stats = statsFor("INSTRUCTOR", {
      courseTotal: 4,
      stats: { studentCount: 88, materialCount: 6, chatCount: 11 } as never,
    });

    expect(stats["Courses teaching"]).toBe("4");
    expect(stats["Students enrolled"]).toBe("88");
  });

  it("INSTRUCTOR shows an em dash for the course count while loading", () => {
    expect(statsFor("INSTRUCTOR", { coursesLoading: true })["Courses teaching"]).toBe("—");
  });
});

/** The shared DashboardView renders <Link>s, so a router context is required. */
const renderInRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const dataWith = (overrides: Partial<DashboardData> = {}): DashboardData => ({
  stats: {
    chatCount: 0,
    chatCountWeek: 0,
    materialCount: 0,
    studentCount: 0,
    instructorCount: 0,
    totalUsers: 0,
    activeCourseCount: 0,
  },
  recentChats: [],
  courses: [],
  courseTotal: 0,
  ...overrides,
});

describe("DashboardBody", () => {
  it("renders ADMIN quick actions and the platform user total from loader data", () => {
    renderInRouter(
      <DashboardBody
        effectiveRole="ADMIN"
        data={dataWith({ userTotal: 500, activeCourseTotal: 12 })}
      />,
    );

    // Admin panel is quick actions, not course cards.
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(screen.getByText("Total users")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("renders UNIT_ADMIN unit + active course totals off loader data", () => {
    renderInRouter(
      <DashboardBody
        effectiveRole="UNIT_ADMIN"
        data={dataWith({ courseTotal: 7, activeCourseTotal: 5 })}
      />,
    );

    expect(screen.getByText("Unit courses")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
