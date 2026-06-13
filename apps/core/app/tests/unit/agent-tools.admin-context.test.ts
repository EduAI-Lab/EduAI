// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  enrollment: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/bug-reports/server", () => ({
  listBugReports: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/agent-tools/course-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAccessibleCourses: vi.fn(),
}));

import { listBugReports } from "~/lib/bug-reports/server";
import { getAccessibleCourse } from "~/lib/agent-tools/course-context.server";
import {
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminUsers,
} from "~/lib/agent-tools/admin-context.server";

const ADMIN = { id: "a1", role: "ADMIN" };
const STUDENT = { id: "s1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminUsers", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminUsers(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns users for admin", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1", email: "a@test.com" }]);
    const result = await listAdminUsers(ADMIN);
    expect(result.users).toHaveLength(1);
  });
});

describe("listAdminCourseEnrollments", () => {
  it("returns validation error for bad enrolledSince", async () => {
    const result = await listAdminCourseEnrollments(ADMIN, "c1", {
      enrolledSince: "not-a-date",
    });
    expect(result).toEqual({
      error: "VALIDATION_ERROR",
      fields: { enrolledSince: "invalid ISO date" },
    });
    expect(getAccessibleCourse).not.toHaveBeenCalled();
  });

  it("filters enrollments by date window", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ course: { id: "c1" } } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: "e1",
        userId: "u1",
        role: "STUDENT",
        isActive: true,
        enrolledAt: new Date("2026-06-01"),
        user: { email: "s@test.com", name: "Student" },
      },
    ]);

    const result = await listAdminCourseEnrollments(ADMIN, "c1", {
      enrolledSince: "2026-06-01T00:00:00.000Z",
    });
    expect(result.count).toBe(1);
    expect(prismaMock.enrollment.findMany).toHaveBeenCalled();
  });
});

describe("listAdminBugReportsForChat", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminBugReportsForChat(STUDENT, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("delegates to listBugReports for admin", async () => {
    vi.mocked(listBugReports).mockResolvedValue({
      reports: [{ id: "b1", source: "CORE", status: "UNHANDLED", description: "x" }],
      total: 1,
      limit: 50,
      offset: 0,
    } as never);

    const result = await listAdminBugReportsForChat(ADMIN, { status: "UNHANDLED" });
    expect(result.total).toBe(1);
    expect(listBugReports).toHaveBeenCalledWith({
      status: "UNHANDLED",
      source: undefined,
      limit: 50,
      offset: 0,
    });
  });
});
