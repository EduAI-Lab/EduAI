// @vitest-environment node
// #1213 — GET /api/dashboard/stats: auth gate + per-role stat aggregation
// branches (ADMIN, UNIT_ADMIN, INSTRUCTOR, STUDENT/TA).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: { groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    user: { groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    chat: { count: vi.fn().mockResolvedValue(0) },
    enrollment: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    course: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  buildCourseListFilter: vi.fn().mockResolvedValue({}),
}));

import { loader } from "~/routes/api/dashboard.stats";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { buildCourseListFilter } from "~/lib/auth/course-access.server";

function makeArgs() {
  return {
    request: new Request("http://localhost/api/dashboard/stats"),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.courseMaterial.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.user.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.chat.count).mockResolvedValue(0);
  vi.mocked(prisma.courseMaterial.count).mockResolvedValue(0);
  vi.mocked(prisma.enrollment.count).mockResolvedValue(0);
  vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.user.count).mockResolvedValue(0);
  vi.mocked(prisma.course.count).mockResolvedValue(0);
  vi.mocked(prisma.course.findMany).mockResolvedValue([] as never);
});

describe("GET /api/dashboard/stats", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeArgs());
    expect(res.status).toBe(401);
  });

  it("returns platform-wide stats for an ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.chat.count).mockResolvedValueOnce(100).mockResolvedValueOnce(10);
    vi.mocked(prisma.courseMaterial.count).mockResolvedValue(20);
    vi.mocked(prisma.enrollment.count).mockResolvedValue(50);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(5).mockResolvedValueOnce(80);
    vi.mocked(prisma.course.count).mockResolvedValue(12);
    vi.mocked(prisma.courseMaterial.groupBy).mockResolvedValue([
      { status: "READY", _count: { _all: 15 } },
      { status: "FAILED", _count: { _all: 2 } },
    ] as never);
    vi.mocked(prisma.user.groupBy).mockResolvedValue([
      { role: "STUDENT", _count: { _all: 70 } },
      { role: "ADMIN", _count: { _all: 2 } },
    ] as never);

    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      chatCount: 100,
      chatCountWeek: 10,
      materialCount: 20,
      studentCount: 50,
      totalUsers: 80,
      activeCourseCount: 12,
      materialsByStatus: { ready: 15, processing: 0, failed: 2 },
      usersByRole: { students: 70, instructors: 0, admins: 2, other: 0 },
    });
  });

  it("scopes stats to authorized courses for a UNIT_ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([
      { id: "course-1", instructorId: "instructor-1", isActive: true },
    ] as never);
    vi.mocked(prisma.chat.count).mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    vi.mocked(prisma.courseMaterial.count).mockResolvedValue(3);
    vi.mocked(prisma.enrollment.count).mockResolvedValue(9);

    const res = await loader(makeArgs());
    const body = await res.json();
    expect(buildCourseListFilter).toHaveBeenCalled();
    expect(body).toMatchObject({
      chatCount: 5,
      chatCountWeek: 1,
      materialCount: 3,
      studentCount: 9,
      instructorCount: 1,
      activeCourseCount: 1,
    });
  });

  it("returns zeroed stats for a UNIT_ADMIN with no authorized courses", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([]);

    const res = await loader(makeArgs());
    const body = await res.json();
    expect(body).toMatchObject({ chatCount: 0, chatCountWeek: 0, materialCount: 0, studentCount: 0 });
    expect(prisma.chat.count).not.toHaveBeenCalled();
  });

  it("scopes stats to taught courses for an INSTRUCTOR", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "instructor-1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([{ courseId: "course-1" }] as never);
    vi.mocked(prisma.chat.count).mockResolvedValueOnce(7).mockResolvedValueOnce(2);
    vi.mocked(prisma.courseMaterial.count).mockResolvedValue(4);
    vi.mocked(prisma.enrollment.count).mockResolvedValue(11);

    const res = await loader(makeArgs());
    const body = await res.json();
    expect(body).toMatchObject({ chatCount: 7, chatCountWeek: 2, materialCount: 4, studentCount: 11 });
  });

  it("scopes stats to the caller's own chats/enrollments for a STUDENT", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "student-1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([{ courseId: "course-1" }] as never);
    vi.mocked(prisma.chat.count).mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    vi.mocked(prisma.courseMaterial.count).mockResolvedValue(6);

    const res = await loader(makeArgs());
    const body = await res.json();
    expect(prisma.chat.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "student-1" } }),
    );
    expect(body).toMatchObject({ chatCount: 3, chatCountWeek: 1, materialCount: 6 });
  });
});
