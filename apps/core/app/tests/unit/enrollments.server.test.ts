// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => {
  const tx = {
    enrollment: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    user: { findUnique: vi.fn() },
    enrollment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    // The mutation helpers pass a callback; `getCourseEnrollmentsPage` passes an array
    // of promises. Support both so one mock serves every caller in this file.
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => Promise<unknown>)(tx),
    ),
    __tx: tx,
  };
});

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import {
  addEnrollment,
  updateEnrollmentRole,
  deactivateEnrollment,
  requiredRankForEnrollmentRole,
  canAddEnrollmentRole,
  isEnrollmentRole,
  getCourseEnrollments,
  getCourseEnrollmentsPage,
} from "~/lib/courses/enrollments.server";

const tx = prismaMock.__tx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requiredRankForEnrollmentRole", () => {
  it("requires rank 3 for INSTRUCTOR and rank 2 otherwise", () => {
    expect(requiredRankForEnrollmentRole("INSTRUCTOR")).toBe(3);
    expect(requiredRankForEnrollmentRole("STUDENT")).toBe(2);
    expect(requiredRankForEnrollmentRole("TA")).toBe(2);
    expect(canAddEnrollmentRole(2, "INSTRUCTOR")).toBe(false);
    expect(canAddEnrollmentRole(3, "INSTRUCTOR")).toBe(true);
  });
});

describe("addEnrollment", () => {
  it("returns 422 for an invalid role", async () => {
    const result = await addEnrollment("c1", { userId: "u1", role: "OVERLORD" }, 4);
    expect(result.status).toBe("422");
  });

  it("returns 403 when actor rank is too low for the target role", async () => {
    const result = await addEnrollment("c1", { userId: "u1", role: "INSTRUCTOR" }, 2);
    expect(result).toEqual({ status: "403", error: "Forbidden" });
  });

  it("returns 422 USER_NOT_FOUND for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await addEnrollment("c1", { userId: "ghost", role: "STUDENT" }, 2);
    expect(result).toEqual({ status: "422", error: "USER_NOT_FOUND" });
  });

  it("creates an active enrollment and returns 201", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockResolvedValue({ id: "e1" });
    const result = await addEnrollment("c1", { userId: "u1", role: "TA" }, 2);
    expect(result.status).toBe("201");
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: { courseId: "c1", userId: "u1", role: "TA", isActive: true },
    });
  });

  it("returns 409 ALREADY_ENROLLED when an active enrollment already exists (§6 — promote via PATCH)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.0.0",
      }),
    );
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "e1", isActive: true });
    const result = await addEnrollment("c1", { userId: "u1", role: "STUDENT" }, 2);
    expect(result).toEqual({ status: "409", error: "ALREADY_ENROLLED" });
  });

  it("reactivates an inactive enrollment with the requested role and returns 201 (#685 review)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.0.0",
      }),
    );
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "e1", isActive: false });
    prismaMock.enrollment.update.mockResolvedValue({ id: "e1", role: "TA", isActive: true });
    const result = await addEnrollment("c1", { userId: "u1", role: "TA" }, 2);
    expect(result.status).toBe("201");
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { role: "TA", isActive: true },
    });
  });
});

describe("updateEnrollmentRole — instructor-floor invariant (§6)", () => {
  it("returns 404 when the enrollment does not exist in the course", async () => {
    tx.enrollment.findFirst.mockResolvedValue(null);
    const result = await updateEnrollmentRole("c1", "missing", { role: "TA" });
    expect(result.status).toBe("404");
  });

  it("rejects demoting the LAST active instructor with 409 (#305)", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "INSTRUCTOR", isActive: true,
    });
    tx.enrollment.count.mockResolvedValue(1);
    const result = await updateEnrollmentRole("c1", "e1", { role: "STUDENT" });
    expect(result).toEqual({
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    });
    expect(tx.enrollment.update).not.toHaveBeenCalled();
  });

  it("allows demotion when another active instructor remains", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "INSTRUCTOR", isActive: true,
    });
    tx.enrollment.count.mockResolvedValue(2);
    tx.enrollment.update.mockResolvedValue({ id: "e1", role: "STUDENT" });
    const result = await updateEnrollmentRole("c1", "e1", { role: "STUDENT" });
    expect(result.status).toBe("200");
  });

  it("skips the floor check when promoting TO instructor", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "STUDENT", isActive: true,
    });
    tx.enrollment.update.mockResolvedValue({ id: "e1", role: "INSTRUCTOR" });
    const result = await updateEnrollmentRole("c1", "e1", { role: "INSTRUCTOR" });
    expect(result.status).toBe("200");
    expect(tx.enrollment.count).not.toHaveBeenCalled();
  });

  it("promotes STUDENT to TA without a floor check", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "STUDENT", isActive: true,
    });
    tx.enrollment.update.mockResolvedValue({ id: "e1", role: "TA" });
    const result = await updateEnrollmentRole("c1", "e1", { role: "TA" });
    expect(result.status).toBe("200");
    expect(tx.enrollment.count).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid role", async () => {
    const result = await updateEnrollmentRole("c1", "e1", { role: "WIZARD" });
    expect(result.status).toBe("422");
  });
});

describe("deactivateEnrollment — instructor-floor invariant (§6)", () => {
  it("returns 404 when the enrollment does not exist in the course", async () => {
    tx.enrollment.findFirst.mockResolvedValue(null);
    const result = await deactivateEnrollment("c1", "missing");
    expect(result.status).toBe("404");
  });

  it("rejects deactivating the LAST active instructor with 409 — no ADMIN override", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "INSTRUCTOR", isActive: true,
    });
    tx.enrollment.count.mockResolvedValue(1);
    const result = await deactivateEnrollment("c1", "e1");
    expect(result).toEqual({
      status: "409",
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    });
    expect(tx.enrollment.update).not.toHaveBeenCalled();
  });

  it("deactivates an instructor when another active instructor remains", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "INSTRUCTOR", isActive: true,
    });
    tx.enrollment.count.mockResolvedValue(2);
    tx.enrollment.update.mockResolvedValue({ id: "e1", isActive: false });
    const result = await deactivateEnrollment("c1", "e1");
    expect(result.status).toBe("204");
    expect(tx.enrollment.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { isActive: false },
    });
  });

  it("deactivates a STUDENT without a floor check", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "STUDENT", isActive: true,
    });
    tx.enrollment.update.mockResolvedValue({ id: "e1", isActive: false });
    const result = await deactivateEnrollment("c1", "e1");
    expect(result.status).toBe("204");
    expect(tx.enrollment.count).not.toHaveBeenCalled();
  });

  it("skips the floor check for an already-inactive instructor enrollment", async () => {
    tx.enrollment.findFirst.mockResolvedValue({
      id: "e1", courseId: "c1", role: "INSTRUCTOR", isActive: false,
    });
    tx.enrollment.update.mockResolvedValue({ id: "e1", isActive: false });
    const result = await deactivateEnrollment("c1", "e1");
    expect(result.status).toBe("204");
    expect(tx.enrollment.count).not.toHaveBeenCalled();
  });
});

/**
 * #1369: these two readers switched from `include` to an explicit `select`. The shape they
 * ask Prisma for IS the contract with `mapEnrollment`, so assert on the query argument
 * rather than on a hand-written fixture that could drift from what the DB returns.
 */
const EXPECTED_SELECT = {
  id: true,
  userId: true,
  role: true,
  enrolledAt: true,
  isActive: true,
  user: { select: { email: true, name: true, studentId: true } },
};

describe("isEnrollmentRole", () => {
  it("accepts the three enrollment roles and rejects anything else", () => {
    expect(isEnrollmentRole("STUDENT")).toBe(true);
    expect(isEnrollmentRole("TA")).toBe(true);
    expect(isEnrollmentRole("INSTRUCTOR")).toBe(true);
    expect(isEnrollmentRole("ADMIN")).toBe(false);
    expect(isEnrollmentRole(null)).toBe(false);
    expect(isEnrollmentRole(3)).toBe(false);
  });
});

describe("getCourseEnrollments (#1369 select narrowing)", () => {
  it("selects only the columns the mapper reads, unfiltered and ordered by enrolledAt", async () => {
    const rows = [{ id: "e1" }, { id: "e2" }];
    prismaMock.enrollment.findMany.mockResolvedValue(rows);

    const result = await getCourseEnrollments("c1");

    expect(result).toBe(rows);
    const arg = prismaMock.enrollment.findMany.mock.calls[0]![0];
    expect(arg).toEqual({
      where: { courseId: "c1" },
      select: EXPECTED_SELECT,
      orderBy: { enrolledAt: "asc" },
    });
    // The AI Tutor full-sync contract: no `include`, no isActive filter, no limit.
    expect(arg).not.toHaveProperty("include");
    expect(arg).not.toHaveProperty("take");
  });
});

describe("getCourseEnrollmentsPage (#1369 select narrowing)", () => {
  it("takes limit + 1 without a cursor and reports nextCursor when a further page exists", async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }, { id: "e3" }]);
    prismaMock.enrollment.count.mockResolvedValue(9);

    const result = await getCourseEnrollmentsPage("c1", { cursor: null, limit: 2 });

    expect(result.page).toEqual([{ id: "e1" }, { id: "e2" }]);
    expect(result.nextCursor).toBe("e2");
    expect(result.total).toBe(9);

    const arg = prismaMock.enrollment.findMany.mock.calls[0]![0];
    expect(arg.select).toEqual(EXPECTED_SELECT);
    expect(arg).not.toHaveProperty("include");
    expect(arg.where).toEqual({ courseId: "c1", role: "STUDENT", isActive: true });
    expect(arg.orderBy).toEqual([{ enrolledAt: "asc" }, { id: "asc" }]);
    expect(arg.take).toBe(3);
    // No cursor passed, so Prisma must not receive a `cursor`/`skip` pair.
    expect(arg).not.toHaveProperty("cursor");
    expect(arg).not.toHaveProperty("skip");
    expect(prismaMock.enrollment.count).toHaveBeenCalledWith({
      where: { courseId: "c1", role: "STUDENT", isActive: true },
    });
  });

  it("resumes after the cursor row and returns a null nextCursor on the last page", async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([{ id: "e4" }]);
    prismaMock.enrollment.count.mockResolvedValue(4);

    const result = await getCourseEnrollmentsPage("c1", { cursor: "e3", limit: 2 });

    expect(result.page).toEqual([{ id: "e4" }]);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(4);

    const arg = prismaMock.enrollment.findMany.mock.calls[0]![0];
    expect(arg.select).toEqual(EXPECTED_SELECT);
    expect(arg.cursor).toEqual({ id: "e3" });
    expect(arg.skip).toBe(1);
  });
});
