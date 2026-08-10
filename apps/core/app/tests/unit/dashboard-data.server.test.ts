/**
 * The dashboard resolves its data in the route's SSR loader (#1220). This pins
 * the per-role query gating that used to live in the client bodies (#1041):
 *   - ADMIN reads a `countOnly` active-course total and the platform user
 *     total; it never fetches a page of course rows it wouldn't render.
 *   - UNIT_ADMIN resolves its access-scoped course list exactly once and derives
 *     the stats, the visible total and the active total from it — one
 *     `buildCourseListFilter` + one course read, not three — and never reads the
 *     platform user total.
 *   - The course-card roles (INSTRUCTOR/TA/STUDENT) fetch exactly one small
 *     page and expose `courseTotal`, with no admin-only aggregates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDashboardData } from "~/lib/dashboard/dashboard-data.server";
import { listCoursesForUser } from "~/lib/courses/server";
import { listChats } from "~/lib/chat-history/server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/courses/server", () => ({ listCoursesForUser: vi.fn() }));
vi.mock("~/lib/chat-history/server", () => ({ listChats: vi.fn() }));
vi.mock("~/lib/auth/course-access.server", () => ({
  buildCourseListFilter: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/lib/prisma.server", () => {
  // computeDashboardStats hits many models; none of their values matter here,
  // so one stub model answers every access.
  const model = {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
  };
  return { default: new Proxy({}, { get: () => model }) };
});

const mockListCourses = vi.mocked(listCoursesForUser);
const mockListChats = vi.mocked(listChats);

const userWith = (role: string) => ({ id: "u1", role }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockListChats.mockResolvedValue([]);
  mockListCourses.mockResolvedValue({ courses: [], total: 0 } as never);
  // The prisma stub shares one model object across every model, so a per-test
  // `findMany` override would otherwise leak into the next test.
  vi.mocked(prisma.course.findMany).mockResolvedValue([] as never);
});

describe("loadDashboardData query gating", () => {
  it("ADMIN takes one active-course total read and a platform user total", async () => {
    const data = await loadDashboardData(userWith("ADMIN"));

    expect(mockListCourses).toHaveBeenCalledTimes(1);
    expect(mockListCourses).toHaveBeenCalledWith(expect.anything(), {
      countOnly: true,
      isActive: true,
    });
    expect(typeof data.userTotal).toBe("number");
    expect(typeof data.activeCourseTotal).toBe("number");
    expect(data.courses).toEqual([]);
  });

  it("UNIT_ADMIN resolves its course scope once and derives both totals from it", async () => {
    const courseFindMany = vi.mocked(prisma.course.findMany);
    courseFindMany.mockResolvedValue([
      { id: "c1", instructorId: "i1", isActive: true },
      { id: "c2", instructorId: "i2", isActive: false },
    ] as never);

    const data = await loadDashboardData(userWith("UNIT_ADMIN"));

    // The stats, the visible total and the active total all read the one scope.
    expect(vi.mocked(buildCourseListFilter)).toHaveBeenCalledTimes(1);
    expect(courseFindMany).toHaveBeenCalledTimes(1);
    expect(mockListCourses).not.toHaveBeenCalled();
    expect(data.courseTotal).toBe(2);
    expect(data.activeCourseTotal).toBe(1);
    expect(data.userTotal).toBeUndefined();
    expect(data.courses).toEqual([]);
  });

  it("STUDENT fetches one small course page and exposes courseTotal, no admin aggregates", async () => {
    mockListCourses.mockResolvedValue({
      courses: [
        { id: "c1", code: "MATH 200", name: "Calc III", term: "W1", year: 2026 },
      ],
      total: 3,
    } as never);

    const data = await loadDashboardData(userWith("STUDENT"));

    expect(mockListCourses).toHaveBeenCalledTimes(1);
    expect(mockListCourses).toHaveBeenCalledWith(expect.anything(), { pageSize: 5 });
    expect(data.courseTotal).toBe(3);
    expect(data.courses).toHaveLength(1);
    expect(data.userTotal).toBeUndefined();
    expect(data.activeCourseTotal).toBeUndefined();
  });
});
