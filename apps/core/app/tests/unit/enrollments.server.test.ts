// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    enrollment: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
  it("returns 400 for an invalid role", async () => {
    const result = await addEnrollment("c1", { userId: "u1", role: "OVERLORD" });
    expect(result.status).toBe("400");
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

  it("returns 409 ALREADY_ENROLLED when an active enrollment already exists (§6 — promote via PATCH)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockRejectedValue({ code: "P2002" });
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "e1", isActive: true });
    const result = await addEnrollment("c1", { userId: "u1", role: "STUDENT" });
    expect(result).toEqual({ status: "409", error: "ALREADY_ENROLLED" });
  });

  it("reactivates an inactive enrollment with the requested role and returns 201 (#685 review)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.enrollment.create.mockRejectedValue({ code: "P2002" });
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "e1", isActive: false });
    prismaMock.enrollment.update.mockResolvedValue({ id: "e1", role: "TA", isActive: true });
    const result = await addEnrollment("c1", { userId: "u1", role: "TA" });
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

  it("returns 400 for an invalid role", async () => {
    const result = await updateEnrollmentRole("c1", "e1", { role: "WIZARD" });
    expect(result.status).toBe("400");
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
