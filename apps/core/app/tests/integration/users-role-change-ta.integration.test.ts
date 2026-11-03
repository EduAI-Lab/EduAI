// @vitest-environment node
//
// #2112: making an instructor a TA (platform role -> STUDENT) must turn their
// INSTRUCTOR enrollments into TA ones in the same transaction as the role write.

import type { JsonObject } from "~/lib/json-value";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { resolveCourseAccess } from "~/lib/auth/course-access.server";
import { auth } from "~/lib/auth/server";

const getSession = vi.mocked(auth.api.getSession);

const suffix = randomUUID().slice(0, 8);
let adminId: string;
const userIds: string[] = [];
const courseIds: string[] = [];
let counter = 0;

async function createUser(role: UserRole) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `role-change-ta-${counter}-${suffix}@test.local`,
      name: `Role Change TA ${counter}`,
      role,
      emailVerified: true,
      isActive: true,
    },
  });
  userIds.push(user.id);
  return user.id;
}

async function createCourse(instructorId: string) {
  counter += 1;
  const course = await prisma.course.create({
    data: {
      name: `Role Change TA Course ${counter}`,
      code: `RCT ${counter}`,
      section: "001",
      term: "W1",
      year: 2025,
      startDate: new Date("2025-09-01"),
      instructorId,
    },
  });
  courseIds.push(course.id);
  return course.id;
}

function enrollInstructor(courseId: string, userId: string, enrolledAt: Date) {
  return prisma.enrollment.create({
    data: { courseId, userId, role: "INSTRUCTOR", isActive: true, enrolledAt },
  });
}

/**
 * Target teaches A (as course head) and B. A always has a second, later-enrolled
 * instructor; B gets one only when `soleInstructorOfB` is false.
 */
async function setup(role: UserRole, soleInstructorOfB = false) {
  const targetId = await createUser(role);
  const otherId = await createUser("INSTRUCTOR");
  const courseA = await createCourse(targetId);
  const courseB = await createCourse(targetId);
  await enrollInstructor(courseA, targetId, new Date("2025-01-01"));
  await enrollInstructor(courseA, otherId, new Date("2025-01-02"));
  await enrollInstructor(courseB, targetId, new Date("2025-01-01"));
  if (!soleInstructorOfB) await enrollInstructor(courseB, otherId, new Date("2025-01-02"));
  return { targetId, otherId, courseA, courseB };
}

async function enrollmentRole(courseId: string, userId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: { role: true },
  });
  return enrollment?.role;
}

function patchUser(userId: string, body: JsonObject) {
  return handleUsersApiRequest(
    new Request(`http://localhost/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "session=admin" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  adminId = await createUser("ADMIN");
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

beforeEach(() => {
  getSession.mockResolvedValue({
    user: { id: adminId, role: "ADMIN", name: "Role Change Admin", email: "admin@test.local" },
  } as never);
});

describe("PATCH /api/users/:id — instructor enrollments on a change to STUDENT (#2112)", () => {
  it("converts every INSTRUCTOR enrollment to TA and hands off the course head", async () => {
    const { targetId, otherId, courseA, courseB } = await setup("INSTRUCTOR");

    const res = await patchUser(targetId, { role: "STUDENT", taCourseIds: [] });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taCourseIds).toEqual(expect.arrayContaining([courseA, courseB]));
    expect(await enrollmentRole(courseA, targetId)).toBe("TA");
    expect(await enrollmentRole(courseB, targetId)).toBe("TA");
    const course = await prisma.course.findUnique({
      where: { id: courseA },
      select: { instructorId: true },
    });
    expect(course?.instructorId).toBe(otherId);
    const access = await resolveCourseAccess(
      { id: targetId, role: "STUDENT", authorizedUnits: [] },
      courseA,
    );
    expect(access?.level).toBe("ta");
  });

  it("blocks with 409 and rolls back when the user is a course's only instructor", async () => {
    const { targetId, courseA, courseB } = await setup("INSTRUCTOR", true);

    const res = await patchUser(targetId, { role: "STUDENT", taCourseIds: [] });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("INSTRUCTOR_FLOOR_VIOLATION");
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    expect(user?.role).toBe("INSTRUCTOR");
    expect(await enrollmentRole(courseA, targetId)).toBe("INSTRUCTOR");
    expect(await enrollmentRole(courseB, targetId)).toBe("INSTRUCTOR");
  });

  it("converts enrollments when taCourseIds is omitted", async () => {
    const { targetId, courseA, courseB } = await setup("INSTRUCTOR");

    const res = await patchUser(targetId, { role: "STUDENT" });

    expect(res.status).toBe(200);
    expect(await enrollmentRole(courseA, targetId)).toBe("TA");
    expect(await enrollmentRole(courseB, targetId)).toBe("TA");
  });

  it("leaves INSTRUCTOR enrollments alone on a change to a non-STUDENT role", async () => {
    const { targetId, courseA, courseB } = await setup("ADMIN");

    const res = await patchUser(targetId, { role: "INSTRUCTOR" });

    expect(res.status).toBe(200);
    expect(await enrollmentRole(courseA, targetId)).toBe("INSTRUCTOR");
    expect(await enrollmentRole(courseB, targetId)).toBe("INSTRUCTOR");
  });

  it("repairs an already-STUDENT user who still holds an INSTRUCTOR enrollment", async () => {
    const { targetId, courseA, courseB } = await setup("STUDENT");

    // Before #2112 this returned 409 TA_INSTRUCTOR_ENROLLMENT_CONFLICT.
    const res = await patchUser(targetId, { role: "STUDENT", taCourseIds: [courseA] });

    expect(res.status).toBe(200);
    expect(await enrollmentRole(courseA, targetId)).toBe("TA");
    expect(await enrollmentRole(courseB, targetId)).toBe("TA");
  });

  it("does not touch INSTRUCTOR enrollments on a name-only PATCH", async () => {
    const { targetId, courseA } = await setup("STUDENT");

    const res = await patchUser(targetId, { name: "Renamed Only" });

    expect(res.status).toBe(200);
    expect(await enrollmentRole(courseA, targetId)).toBe("INSTRUCTOR");
  });
});
