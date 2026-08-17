import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    courseOffering: { findUnique: vi.fn() },
    courseEnrollment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    courseInstructor: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../src/services/eduaiClient.js", () => ({
  getEduAiCourseEnrollmentServiceKey: vi.fn(),
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
}));

import { prisma } from "../../src/config/database.js";
import { getEduAiCourseEnrollmentServiceKey } from "../../src/services/eduaiClient.js";
import {
  authorizeLiveStudentEnrollment,
  resetEnrollmentSyncThrottleForTests,
} from "../../src/services/enrollmentSync.js";

const COURSE = { id: 1, coreOfferingId: "core-course-1" };
const ACTIVE_STUDENT = {
  studentId: "student-1",
  studentEmail: "student@example.com",
  studentName: "Student One",
  enrolledAt: "2026-01-01T00:00:00.000Z",
  isActive: true,
  role: "STUDENT",
};
const ACTIVE_TA = { ...ACTIVE_STUDENT, role: "TA" };
const ACTIVE_INSTRUCTOR = { ...ACTIVE_STUDENT, studentId: "prof-1", role: "INSTRUCTOR" };

beforeEach(() => {
  vi.clearAllMocks();
  resetEnrollmentSyncThrottleForTests();
  prisma.courseOffering.findUnique.mockResolvedValue(COURSE);
  prisma.courseEnrollment.findMany.mockResolvedValue([{ userId: "student-1", role: "STUDENT" }]);
  prisma.courseEnrollment.findUnique.mockResolvedValue(null);
  prisma.courseEnrollment.createMany.mockResolvedValue({ count: 0 });
  prisma.courseEnrollment.deleteMany.mockResolvedValue({ count: 1 });
  prisma.courseEnrollment.update.mockResolvedValue({});
  prisma.courseInstructor.findMany.mockResolvedValue([]);
  prisma.courseInstructor.findUnique.mockResolvedValue(null);
  prisma.courseInstructor.createMany.mockResolvedValue({ count: 0 });
  prisma.courseInstructor.deleteMany.mockResolvedValue({ count: 0 });
});

describe("authorizeLiveStudentEnrollment", () => {
  it("authorizes only an exact active Core INSTRUCTOR role", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(ACTIVE_INSTRUCTOR);

    const result = await authorizeLiveStudentEnrollment(1, "prof-1", {
      allowedRoles: ["INSTRUCTOR"],
    });

    expect(result).toEqual({ allowed: true, state: "allowed", role: "INSTRUCTOR" });
    expect(prisma.courseInstructor.createMany).not.toHaveBeenCalled();
  });

  it("allows a local STUDENT row when Core confirms active STUDENT enrollment", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(ACTIVE_STUDENT);

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toEqual({ allowed: true, state: "allowed", role: "STUDENT" });
    expect(getEduAiCourseEnrollmentServiceKey).toHaveBeenCalledWith("core-course-1", "student-1", {
      signal: expect.any(AbortSignal),
    });
  });

  it("does not reconcile the full local roster while authorizing one caller", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(ACTIVE_STUDENT);

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toEqual({ allowed: true, state: "allowed", role: "STUDENT" });
    expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.findMany).not.toHaveBeenCalled();
  });

  it("uses a short per-user cache to absorb concurrent authorization bursts", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(ACTIVE_STUDENT);

    await authorizeLiveStudentEnrollment(1, "student-1");
    await authorizeLiveStudentEnrollment(1, "student-1");

    expect(getEduAiCourseEnrollmentServiceKey).toHaveBeenCalledTimes(1);
  });

  it("prunes a stale local student row when Core no longer lists the user", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(null);

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toMatchObject({ allowed: false, state: "denied", role: null });
    expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
  });

  it("updates a local STUDENT row to TA and denies the student operation", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue(ACTIVE_TA);

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toEqual({ allowed: false, state: "denied", role: "TA" });
    expect(prisma.courseEnrollment.update).not.toHaveBeenCalled();
  });

  it("prunes a local row when Core marks the enrollment inactive", async () => {
    getEduAiCourseEnrollmentServiceKey.mockResolvedValue({ ...ACTIVE_STUDENT, isActive: false });

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toMatchObject({ allowed: false, state: "denied", role: null });
    expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", new Error("Core unavailable")],
    ["timeout", Object.assign(new Error("deadline exceeded"), { name: "TimeoutError" })],
    ["malformed response", new Error("Invalid response")],
  ])("fails closed as unavailable on Core %s without local writes", async (_label, response) => {
    getEduAiCourseEnrollmentServiceKey.mockRejectedValue(response);

    const result = await authorizeLiveStudentEnrollment(1, "student-1");

    expect(result).toEqual({ allowed: false, state: "unavailable", role: null });
    expect(prisma.courseEnrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.update).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.courseEnrollment.findUnique).not.toHaveBeenCalled();
  });
});
