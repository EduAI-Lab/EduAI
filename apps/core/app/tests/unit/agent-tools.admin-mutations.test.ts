// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  enrollment: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/courses/enrollments.server", () => ({
  addEnrollment: vi.fn(),
  updateEnrollmentRole: vi.fn(),
  deactivateEnrollment: vi.fn(),
}));

vi.mock("~/lib/bug-reports/server", () => ({
  updateBugReportStatus: vi.fn(),
}));

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  resolveAdminCourseId: vi.fn(),
  getAccessibleCourse: vi.fn(),
  resolveAdminUserId: vi.fn(),
}));

import {
  addEnrollment,
  deactivateEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { updateBugReportStatus } from "~/lib/bug-reports/server";
import { resolveAdminCourseId, resolveAdminUserId, getAccessibleCourse } from "~/lib/agent-tools/admin-context.server";
import {
  createAdminUser,
  deleteAdminUser,
  updateAdminBugReportStatus,
  updateAdminUser,
} from "~/lib/agent-tools/admin-mutations.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };
const STUDENT = { id: "student-1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAdminUser", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminUser(STUDENT, {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("creates user for admin", async () => {
    prismaMock.user.create.mockResolvedValue({
      id: "u1",
      email: "test@example.com",
      name: "Test User",
      role: "STUDENT",
      isActive: true,
      createdAt: new Date(),
    });

    const result = await createAdminUser(ADMIN, {
      name: "Test User",
      email: "test@example.com",
      role: "STUDENT",
    });

    expect(result).toMatchObject({ ok: true, mutation: true, dataSource: "database" });
    expect(prismaMock.user.create).toHaveBeenCalled();
  });
});

describe("updateAdminUser", () => {
  it("blocks self-deactivation", async () => {
    const result = await updateAdminUser(ADMIN, ADMIN.id, { isActive: false });
    expect(result).toEqual({ error: "CANNOT_DEACTIVATE_SELF" });
  });

  it("blocks self role change", async () => {
    const result = await updateAdminUser(ADMIN, ADMIN.id, { role: "STUDENT" });
    expect(result).toEqual({ error: "CANNOT_CHANGE_OWN_ROLE" });
  });
});

describe("deleteAdminUser", () => {
  it("blocks self-delete", async () => {
    const result = await deleteAdminUser(ADMIN, ADMIN.id);
    expect(result).toEqual({ error: "CANNOT_DELETE_SELF" });
  });

  it("deletes other users", async () => {
    prismaMock.user.delete.mockResolvedValue({ id: "u2" });
    const result = await deleteAdminUser(ADMIN, "u2");
    expect(result).toMatchObject({ ok: true, deletedUserId: "u2" });
  });
});

describe("updateAdminBugReportStatus", () => {
  it("returns NOT_FOUND when report missing", async () => {
    vi.mocked(updateBugReportStatus).mockResolvedValue(null);
    const result = await updateAdminBugReportStatus(ADMIN, "missing", "RESOLVED");
    expect(result).toEqual({ error: "NOT_FOUND" });
  });

  it("returns mutation payload on success", async () => {
    vi.mocked(updateBugReportStatus).mockResolvedValue({ id: "b1", status: "RESOLVED" });
    const result = await updateAdminBugReportStatus(ADMIN, "b1", "RESOLVED");
    expect(result).toMatchObject({ ok: true, report: { id: "b1", status: "RESOLVED" } });
  });
});

describe("createAdminEnrollment via addEnrollment", () => {
  it("delegates to addEnrollment after resolving course", async () => {
    const { createAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(resolveAdminUserId).mockResolvedValue({
      userId: "u1",
      email: "s@test.com",
      name: "Student",
    });
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "201",
      enrollment: { id: "e1", role: "STUDENT", userId: "u1", courseId: "c1", isActive: true },
    } as never);

    const prismaEnrollment = vi.fn().mockResolvedValue({
      id: "e1",
      role: "STUDENT",
      isActive: true,
      enrolledAt: new Date(),
      user: { email: "s@test.com", name: "Student" },
    });
    prismaMock.enrollment.findFirst = prismaEnrollment;

    const result = await createAdminEnrollment(ADMIN, {
      courseCode: "COSC 111",
      userId: "u1",
      role: "STUDENT",
    });

    expect(addEnrollment).toHaveBeenCalledWith("c1", { userId: "u1", role: "STUDENT" });
    expect(result).toMatchObject({ ok: true, writeSucceeded: true, verifiedEnrollment: { id: "e1" } });
  });
});

describe("updateAdminEnrollmentRole", () => {
  it("maps instructor floor violation", async () => {
    const { updateAdminEnrollmentRole } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    } as never);

    const result = await updateAdminEnrollmentRole(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
      role: "STUDENT",
    });

    expect(result).toMatchObject({
      writeSucceeded: false,
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    });
  });
});

describe("deactivateAdminEnrollment", () => {
  it("delegates to deactivateEnrollment", async () => {
    const { deactivateAdminEnrollment } = await import("~/lib/agent-tools/admin-mutations.server");
    vi.mocked(resolveAdminCourseId).mockResolvedValue({
      courseId: "c1",
      courseCode: "COSC 111",
    });
    vi.mocked(deactivateEnrollment).mockResolvedValue({
      status: "204",
      role: "STUDENT",
    } as never);

    const result = await deactivateAdminEnrollment(ADMIN, {
      courseId: "c1",
      enrollmentId: "e1",
    });

    expect(deactivateEnrollment).toHaveBeenCalledWith("c1", "e1");
    expect(result).toMatchObject({ ok: true });
  });
});
