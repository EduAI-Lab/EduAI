// @vitest-environment node
//
// #1843 — an admin who instructs a course can reach the instructor view, and
// an admin who does not still cannot. Uses the test database configured in
// apps/core/.env.test.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { seedTestDisciplines } from "../helpers/disciplines";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader as instructorChatLoader } from "~/routes/instructor.chat";
import { teachesCourse } from "~/lib/rbac/instructor-view.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { auth } from "~/lib/auth/server";
import { seedUser, enroll, mockSession, type SeededUser } from "../helpers/rbac";

let teachingAdmin: SeededUser;
let plainAdmin: SeededUser;
let instructor: SeededUser;
let unitAdmin: SeededUser;
let taughtCourseId: string;
let otherCourseId: string;
const courseIds: string[] = [];
const userIds: string[] = [];

function loaderArgs() {
  return {
    request: new Request("http://localhost/instructor/chat", { method: "GET" }),
    params: {},
    context: {},
  } as never;
}

async function seedPublishedCourse(department: string | null = "COSC") {
  const suffix = randomUUID().slice(0, 8);
  const course = await prisma.course.create({
    data: {
      name: `View Switch ${suffix}`,
      code: `VS ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      department,
      isPublished: true,
    },
  });
  courseIds.push(course.id);
  return course;
}

beforeAll(async () => {
  await seedTestDisciplines();
  teachingAdmin = await seedUser({ role: "ADMIN", name: "Dr Mostafa" });
  plainAdmin = await seedUser({ role: "ADMIN", name: "Ops Admin" });
  instructor = await seedUser({ role: "INSTRUCTOR", name: "Dr Abdallah" });
  unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"], name: "Unit Admin" });
  userIds.push(teachingAdmin.id, plainAdmin.id, instructor.id, unitAdmin.id);

  const taught = await seedPublishedCourse();
  taughtCourseId = taught.id;
  const other = await seedPublishedCourse();
  otherCourseId = other.id;

  // The admin and the unit admin genuinely teach the first course.
  await enroll(taughtCourseId, instructor.id, "INSTRUCTOR");
  await enroll(taughtCourseId, teachingAdmin.id, "INSTRUCTOR");
  await enroll(taughtCourseId, unitAdmin.id, "INSTRUCTOR");
  // Nobody teaches the second one except the plain instructor.
  await enroll(otherCourseId, instructor.id, "INSTRUCTOR");
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

describe("#1843 — teachesCourse reads the enrollment the access resolver skips", () => {
  it("is true for an ADMIN who holds an active INSTRUCTOR enrollment", async () => {
    expect(await teachesCourse(teachingAdmin.id, taughtCourseId)).toBe(true);
  });

  it("is false for an ADMIN with no enrollment on the course", async () => {
    expect(await teachesCourse(plainAdmin.id, taughtCourseId)).toBe(false);
    expect(await teachesCourse(teachingAdmin.id, otherCourseId)).toBe(false);
  });

  it("is false once the enrollment is deactivated", async () => {
    const course = await seedPublishedCourse();
    await enroll(course.id, plainAdmin.id, "INSTRUCTOR", false);
    expect(await teachesCourse(plainAdmin.id, course.id)).toBe(false);
  });

  it("is false for a TA enrollment — the role is part of the question", async () => {
    const course = await seedPublishedCourse();
    await enroll(course.id, plainAdmin.id, "TA");
    expect(await teachesCourse(plainAdmin.id, course.id)).toBe(false);
  });
});

describe("#1843 — the access resolver is unchanged", () => {
  it("still resolves a teaching ADMIN to admin level, not instructor", async () => {
    // The switch must not alter the authorization decision. If this ever
    // returns "instructor", the view has started granting something.
    const { access } = await resolveCourseAccessGate(
      { id: teachingAdmin.id, role: "ADMIN" },
      taughtCourseId,
    );
    expect(access?.level).toBe("admin");
    expect(access?.rank).toBe(4);
  });

  it("still resolves a teaching in-unit UNIT_ADMIN to unit level", async () => {
    const { access } = await resolveCourseAccessGate(
      { id: unitAdmin.id, role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      taughtCourseId,
    );
    expect(access?.level).toBe("unit");
  });
});

describe("#1843 — /instructor/chat", () => {
  it("lists the course an ADMIN actually teaches, and offers the view banner", async () => {
    mockSession(teachingAdmin);
    const result = (await instructorChatLoader(loaderArgs())) as unknown as {
      courses: { id: string }[];
      showInstructorViewBanner: boolean;
    };

    expect(result.courses.map((course) => course.id)).toEqual([taughtCourseId]);
    expect(result.showInstructorViewBanner).toBe(true);
  });

  it("still redirects an ADMIN who teaches nothing", async () => {
    // The guarantee: the switch appears only where a real enrollment exists.
    mockSession(plainAdmin);
    const result = (await instructorChatLoader(loaderArgs())) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/dashboard");
  });

  it("lists the course an in-unit UNIT_ADMIN teaches, which the unit lock used to hide", async () => {
    // Before #1843 this course was filtered out: an in-unit UNIT_ADMIN resolves
    // to `unit`, never `instructor`, so the loader dropped it to stay in step
    // with the guard. The guard now admits them, so the filter is gone.
    mockSession(unitAdmin);
    const result = (await instructorChatLoader(loaderArgs())) as unknown as {
      courses: { id: string }[];
      showInstructorViewBanner: boolean;
    };

    expect(result.courses.map((course) => course.id)).toEqual([taughtCourseId]);
    expect(result.showInstructorViewBanner).toBe(true);
  });

  it("does not offer the banner to a plain INSTRUCTOR, who has no other view", async () => {
    mockSession(instructor);
    const result = (await instructorChatLoader(loaderArgs())) as unknown as {
      courses: { id: string }[];
      showInstructorViewBanner: boolean;
    };

    expect(result.courses).toHaveLength(2);
    expect(result.showInstructorViewBanner).toBe(false);
  });

  it("never lists an unpublished course, whatever the platform role", async () => {
    const draft = await seedPublishedCourse();
    await prisma.course.update({ where: { id: draft.id }, data: { isPublished: false } });
    await enroll(draft.id, teachingAdmin.id, "INSTRUCTOR");

    mockSession(teachingAdmin);
    const result = (await instructorChatLoader(loaderArgs())) as unknown as {
      courses: { id: string }[];
    };

    expect(result.courses.map((course) => course.id)).not.toContain(draft.id);
  });
});
