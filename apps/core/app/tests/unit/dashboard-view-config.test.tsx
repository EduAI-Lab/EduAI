/**
 * Unit tests for the per-role dashboard config (#1041).
 *
 * The counts on these dashboards used to come from `array.length` on a
 * full-list read. Under required paging the lists are one page, so ADMIN and
 * UNIT_ADMIN instead take `pageSize: 1` reads and display `stats.total` / the
 * envelope's `total`. That makes two things worth pinning: each `statBuilder`
 * renders a server total (and an em dash, not a misleading 0, while loading),
 * and the admin bodies really do ask for the smallest possible page rather than
 * pulling a page of rows they never render.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const useUsers = vi.fn();
const useCourses = vi.fn();
const useRecentChats = vi.fn();
const useDashboardStats = vi.fn();

vi.mock("~/hooks/api/use-users", () => ({ useUsers: (...a: unknown[]) => useUsers(...a) }));
vi.mock("~/hooks/api/use-courses", () => ({ useCourses: (...a: unknown[]) => useCourses(...a) }));
vi.mock("~/hooks/api/use-recent-chats", () => ({
  useRecentChats: (...a: unknown[]) => useRecentChats(...a),
}));
vi.mock("~/hooks/api/use-dashboard-stats", () => ({
  useDashboardStats: (...a: unknown[]) => useDashboardStats(...a),
}));

import {
  DASHBOARD_CONFIG,
  DashboardAdminBody,
  DashboardUnitAdminBody,
} from "~/components/dashboard/dashboard-view-config";

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

describe("dashboard role bodies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUsers.mockReturnValue({ stats: { total: 500, active: 480, byRole: {} }, isLoading: false });
    useCourses.mockReturnValue({ total: 12, loading: false });
    useRecentChats.mockReturnValue({ chats: [], isLoading: false });
    useDashboardStats.mockReturnValue({ stats: { chatCount: 1 }, isLoading: false });
  });

  it("DashboardAdminBody asks for the smallest page, since it only needs the totals", () => {
    renderInRouter(<DashboardAdminBody />);

    // Quick-actions panel — no course cards are rendered, so a page of rows
    // would be fetched and thrown away.
    expect(useUsers).toHaveBeenCalledWith({ pageSize: 1 });
    expect(useCourses).toHaveBeenCalledWith({ pageSize: 1, isActive: true });
  });

  it("DashboardAdminBody renders the platform user total off stats.total", () => {
    renderInRouter(<DashboardAdminBody />);

    expect(screen.getByText("Total users")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("DashboardUnitAdminBody takes two total-only course reads, one scoped to active", () => {
    renderInRouter(<DashboardUnitAdminBody />);

    expect(useCourses).toHaveBeenCalledWith({ pageSize: 1 });
    expect(useCourses).toHaveBeenCalledWith({ pageSize: 1, isActive: true });
    // Never calls the admin-only users hook.
    expect(useUsers).not.toHaveBeenCalled();
  });

  it("DashboardUnitAdminBody renders its unit course total", () => {
    renderInRouter(<DashboardUnitAdminBody />);

    expect(screen.getByText("Unit courses")).toBeInTheDocument();
  });
});
