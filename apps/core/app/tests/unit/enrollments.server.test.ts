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
    enrollment: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
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
} from "~/lib/courses/enrollments.server";

const tx = prismaMock.__tx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addEnrollment", () => {
  it("returns 422 for an invalid role", async () => {
    const result = await addEnrollment("c1", { userId: "u1", role: "OVERLORD" });
    expect(result.status).toBe("422");
  });

  it("returns 422 USER_NOT_FOUND for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await addEnrollment("c1", { userId: "ghost", role: "STUDENT" });
    expect(result).toEqual({ status: "422", error: "USER_NOT_FOUND" });
  });

  it("creates an active enrollment and returns 201", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockResolvedValue({ id: "e1" });
    const result = await addEnrollment("c1", { userId: "u1", role: "TA" });
    expect(result.status).toBe("201");
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: { courseId: "c1", userId: "u1", role: "TA", isActive: true },
    });
  });

  it("returns 409 ALREADY_ENROLLED on the unique constraint (§6 — promote via PATCH)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.0.0",
      }),
    );
    const result = await addEnrollment("c1", { userId: "u1", role: "STUDENT" });
    expect(result).toEqual({ status: "409", error: "ALREADY_ENROLLED" });
  });

  it("returns 201 on idempotency key replay without creating again", async () => {
    const existing = { id: "e-existing", courseId: "c1", userId: "u1", role: "STUDENT" };
    prismaMock.enrollment.findUnique.mockResolvedValue(existing);
    const result = await addEnrollment("c1", {
      userId: "u1",
      role: "STUDENT",
      idempotencyKey: "idem-enroll-1",
    });
    expect(result).toEqual({ status: "201", enrollment: existing });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it("recovers from idempotency-key race (P2002) by returning the existing enrollment", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "e-race", courseId: "c1", userId: "u1", role: "STUDENT" });
    prismaMock.enrollment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.0.0",
      }),
    );
    const result = await addEnrollment("c1", {
      userId: "u1",
      role: "STUDENT",
      idempotencyKey: "idem-race",
    });
    expect(result.status).toBe("201");
    expect(result.enrollment).toEqual({
      id: "e-race",
      courseId: "c1",
      userId: "u1",
      role: "STUDENT",
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
