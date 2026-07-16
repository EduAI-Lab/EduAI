// @vitest-environment node
//
// A TA is an Enrollment with role="TA" — there is no CourseTA table anymore.
// These tests pin that contract for the course-TA management helpers.

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  course: { findMany: vi.fn() },
  enrollment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getCourseTA,
  addCourseTA,
  removeCourseTA,
  reconcileUserTACourses,
} from "~/lib/courses/tas.server";

const COURSE_ID = "course-1";
const USER = { id: "u-1", name: "Sam Carter", email: "sam@eduai.local" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCourseTA", () => {
  it("returns active TA enrollments shaped as {id, user}", async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: "enr-1", user: USER },
    ]);

    const result = await getCourseTA(COURSE_ID);

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: COURSE_ID, role: "TA", isActive: true },
      }),
    );
    expect(result).toEqual([{ id: "enr-1", user: USER }]);
  });
});

describe("addCourseTA", () => {
  it("upserts an Enrollment with role=TA for an existing STUDENT user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER.id, role: "STUDENT" });
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    prismaMock.enrollment.upsert.mockResolvedValue({ id: "enr-1", user: USER });

    const result = await addCourseTA(COURSE_ID, { userId: USER.id });

    expect(prismaMock.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { courseId: COURSE_ID, userId: USER.id, role: "TA", isActive: true },
        update: { role: "TA", isActive: true },
      }),
    );
    expect(result).toEqual({ ta: { id: "enr-1", user: USER } });
  });

  it("promotes an existing STUDENT enrollment to TA", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER.id, role: "STUDENT" });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    prismaMock.enrollment.upsert.mockResolvedValue({ id: "enr-1", user: USER });

    const result = await addCourseTA(COURSE_ID, { userId: USER.id });
    expect(prismaMock.enrollment.upsert).toHaveBeenCalled();
    expect(result).toEqual({ ta: { id: "enr-1", user: USER } });
  });

  it("rejects an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await addCourseTA(COURSE_ID, { userId: "ghost" });
    expect(result).toEqual({ error: "User not found" });
    expect(prismaMock.enrollment.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-STUDENT platform user (e.g. an INSTRUCTOR account)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER.id, role: "INSTRUCTOR" });
    const result = await addCourseTA(COURSE_ID, { userId: USER.id });
    expect(result).toEqual({ error: "Only STUDENT users can be added as a course TA" });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.upsert).not.toHaveBeenCalled();
  });

  it("never overwrites an existing INSTRUCTOR enrollment with a TA role", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER.id, role: "STUDENT" });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    const result = await addCourseTA(COURSE_ID, { userId: USER.id });
    expect(result).toEqual({
      error: "User is an instructor for this course and cannot be made a TA",
    });
    expect(prismaMock.enrollment.upsert).not.toHaveBeenCalled();
  });

  it("rejects a user already an active TA", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER.id, role: "STUDENT" });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const result = await addCourseTA(COURSE_ID, { userId: USER.id });
    expect(result).toEqual({ error: "User is already a TA for this course" });
    expect(prismaMock.enrollment.upsert).not.toHaveBeenCalled();
  });
});

describe("removeCourseTA", () => {
  it("deactivates the TA enrollment and returns audit fields", async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue({
      id: "enr-1",
      user: { name: USER.name },
    });
    prismaMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
    const result = await removeCourseTA(COURSE_ID, { userId: USER.id });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: { courseId: COURSE_ID, userId: USER.id, role: "TA", isActive: true },
      data: { isActive: false },
    });
    expect(result).toEqual({ success: true, taId: "enr-1", taName: USER.name });
  });

  it("returns an error when no matching TA enrollment exists", async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    const result = await removeCourseTA(COURSE_ID, { userId: USER.id });
    expect(result).toEqual({ error: "TA not found for this course" });
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });
});

describe("reconcileUserTACourses", () => {
  it("creates, reactivates, promotes, and demotes TA enrollments as one desired set", async () => {
    prismaMock.course.findMany.mockResolvedValue([
      { id: "course-1" },
      { id: "course-2" },
      { id: "course-3" },
    ]);
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        { id: "student-enrollment", courseId: "course-1", role: "STUDENT", isActive: true },
        { id: "inactive-ta", courseId: "course-2", role: "TA", isActive: false },
      ]);

    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "STUDENT",
      ["course-1", "course-2", "course-3"],
    );

    expect(result).toEqual({
      ok: true,
      activeTACourseIds: ["course-1", "course-2", "course-3"],
    });
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: "student-enrollment" },
      data: { role: "TA", isActive: true },
    });
    expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
      where: { id: "inactive-ta" },
      data: { role: "TA", isActive: true },
    });
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: { courseId: "course-3", userId: USER.id, role: "TA", isActive: true },
    });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER.id,
        role: "TA",
        isActive: true,
        courseId: { notIn: ["course-1", "course-2", "course-3"] },
      },
      data: { role: "STUDENT", isActive: true },
    });
  });

  it("demotes all TA assignments when a STUDENT has no desired TA courses", async () => {
    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "STUDENT",
      [],
    );

    expect(result).toEqual({ ok: true, activeTACourseIds: [] });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, role: "TA", isActive: true },
      data: { role: "STUDENT", isActive: true },
    });
  });

  it("rejects unknown courses before changing enrollments", async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: "course-1" }]);

    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "STUDENT",
      ["course-1", "missing-course"],
    );

    expect(result).toEqual({ error: "TA_COURSE_NOT_FOUND" });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it("rejects assigning TA courses to a non-STUDENT platform role", async () => {
    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "INSTRUCTOR",
      ["course-1"],
    );

    expect(result).toEqual({ error: "TA_ROLE_MISMATCH" });
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it("clears active TA assignments when the effective role is not STUDENT", async () => {
    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "ADMIN",
      [],
    );

    expect(result).toEqual({ ok: true, activeTACourseIds: [] });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, role: "TA", isActive: true },
      data: { isActive: false },
    });
  });

  it("rejects an INSTRUCTOR enrollment instead of silently demoting it", async () => {
    prismaMock.course.findMany.mockResolvedValue([{ id: "course-1" }]);
    prismaMock.enrollment.findMany.mockResolvedValueOnce([
      { id: "instructor-enrollment", courseId: "course-1", role: "INSTRUCTOR", isActive: true },
    ]);

    const result = await reconcileUserTACourses(
      prismaMock as never,
      USER.id,
      "STUDENT",
      ["course-1"],
    );

    expect(result).toEqual({ error: "TA_INSTRUCTOR_ENROLLMENT_CONFLICT" });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });
});
