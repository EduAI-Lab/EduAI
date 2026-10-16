// @vitest-environment node
//
// #1840 — adding an instructor to an existing course must never demote one.
// Covers the enrollment service, the primary-instructor column, and the
// candidate picker's rank gate. Uses the test database configured in
// apps/core/.env.test.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { seedTestDisciplines } from "../helpers/disciplines";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import {
  addEnrollment,
  deactivateEnrollment,
  updateEnrollmentRole,
} from "~/lib/courses/enrollments.server";
import { listCoursesForUser, updateCourse } from "~/lib/courses/server";
import { getCourseEnrollments } from "~/lib/courses/enrollments.server";
import { getCourseInstructors } from "~/lib/courses/instructors.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { loader as enrollmentsLoader } from "~/routes/api/courses.enrollments";
import { auth } from "~/lib/auth/server";
import { seedUser, mockSession, type SeededUser } from "../helpers/rbac";

const ADMIN_RANK = 4;
const UNIT_ADMIN_RANK = 3;
const INSTRUCTOR_RANK = 2;

let admin: SeededUser;
let abdallah: SeededUser;
let mostafa: SeededUser;
let fahd: SeededUser;
let soumil: SeededUser;
const courseIds: string[] = [];
const userIds: string[] = [];

/** A course that already has one instructor — the state every case starts from. */
async function seedCourseWithInstructor(instructorId: string, department: string | null = "COSC") {
  const suffix = randomUUID().slice(0, 8);
  const course = await prisma.course.create({
    data: {
      name: `Multi Instructor ${suffix}`,
      code: `MI ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      department,
      isPublished: true,
      instructorId,
    },
  });
  courseIds.push(course.id);
  await prisma.enrollment.create({
    data: { courseId: course.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
  });
  return course;
}

/**
 * A course with no head at all. `instructorUserIds: []` is allowed at
 * creation, and the "Assign" control that used to PATCH `instructorId` is gone
 * — so this is the state an admin lands in before adding the first instructor
 * from the Staff tab (#1840 review).
 */
async function seedHeadlessCourse() {
  const suffix = randomUUID().slice(0, 8);
  const course = await prisma.course.create({
    data: {
      name: `Headless ${suffix}`,
      code: `HL ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      department: "COSC",
      isPublished: true,
    },
  });
  courseIds.push(course.id);
  return course;
}

async function activeInstructorIds(courseId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { courseId, role: "INSTRUCTOR", isActive: true },
    orderBy: { enrolledAt: "asc" },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

function patchCourseRequest(courseId: string, body: Record<string, string>) {
  return new Request(`http://localhost/api/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await seedTestDisciplines();
  admin = await seedUser({ role: "ADMIN", name: "Multi Admin" });
  abdallah = await seedUser({ role: "INSTRUCTOR", name: "Dr Abdallah" });
  mostafa = await seedUser({ role: "ADMIN", name: "Dr Mostafa" });
  fahd = await seedUser({ role: "INSTRUCTOR", name: "Fahd" });
  soumil = await seedUser({ role: "STUDENT", name: "Soumil" });
  userIds.push(admin.id, abdallah.id, mostafa.id, fahd.id, soumil.id);
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.questionBank.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.courseTopic.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

describe("#1840 — adding an instructor never removes one", () => {
  it("keeps every existing instructor active when a second and third are added", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    const second = await addEnrollment(
      course.id,
      { userId: mostafa.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );
    expect(second.status).toBe("201");

    const third = await addEnrollment(
      course.id,
      { userId: fahd.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );
    expect(third.status).toBe("201");

    expect(await activeInstructorIds(course.id)).toEqual([abdallah.id, mostafa.id, fahd.id]);
  });

  it("accepts an ADMIN account as a course instructor — platform role is not checked", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    const result = await addEnrollment(
      course.id,
      { userId: mostafa.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );

    expect(result.status).toBe("201");
    const enrolled = await prisma.user.findUnique({ where: { id: mostafa.id } });
    expect(enrolled?.role).toBe("ADMIN");
  });

  it("promotes an existing TA row rather than creating a second row for the same user", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await prisma.enrollment.create({
      data: { courseId: course.id, userId: soumil.id, role: "TA", isActive: true },
    });

    const result = await addEnrollment(
      course.id,
      { userId: soumil.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );

    // @@unique([courseId, userId]) allows one role per course per user.
    expect(result.status).toBe("409");
    const rows = await prisma.enrollment.findMany({
      where: { courseId: course.id, userId: soumil.id },
    });
    expect(rows).toHaveLength(1);
  });

  it("reactivates a previously removed instructor instead of reporting ALREADY_ENROLLED", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await prisma.enrollment.create({
      data: { courseId: course.id, userId: fahd.id, role: "INSTRUCTOR", isActive: false },
    });

    const result = await addEnrollment(
      course.id,
      { userId: fahd.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );

    expect(result.status).toBe("201");
    expect(await activeInstructorIds(course.id)).toContain(fahd.id);
  });

  it("requires rank >= 3 to add an INSTRUCTOR — a course instructor gets 403", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    const denied = await addEnrollment(
      course.id,
      { userId: fahd.id, role: "INSTRUCTOR" },
      INSTRUCTOR_RANK,
    );
    expect(denied.status).toBe("403");

    const allowed = await addEnrollment(
      course.id,
      { userId: fahd.id, role: "INSTRUCTOR" },
      UNIT_ADMIN_RANK,
    );
    expect(allowed.status).toBe("201");
  });
});

describe("#1840 — the instructor floor still holds", () => {
  it("refuses to remove the only instructor", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    const only = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: abdallah.id },
    });

    const result = await deactivateEnrollment(course.id, only.id);

    expect(result).toMatchObject({ status: "409", error: "INSTRUCTOR_FLOOR_VIOLATION" });
    expect(await activeInstructorIds(course.id)).toEqual([abdallah.id]);
  });

  it("allows removing an instructor once a second one exists", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: fahd.id, role: "INSTRUCTOR" }, ADMIN_RANK);
    const extra = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: fahd.id },
    });

    const result = await deactivateEnrollment(course.id, extra.id);

    expect(result.status).toBe("204");
    expect(await activeInstructorIds(course.id)).toEqual([abdallah.id]);
  });
});

describe("#1840 — Course.instructorId stays consistent", () => {
  it("does not demote the sitting instructor when the primary is reassigned", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);

    mockSession(admin);
    const res = await updateCourse(
      patchCourseRequest(course.id, { instructorId: mostafa.id }),
      course.id,
    );
    expect(res.status).toBe(200);

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    expect(updated?.instructorId).toBe(mostafa.id);
    // The regression this issue exists for: Abdallah must still be an instructor.
    expect(await activeInstructorIds(course.id)).toEqual([abdallah.id, mostafa.id]);
  });

  it("enrolls the new primary when they were not yet an instructor, still without demoting", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    mockSession(admin);
    const res = await updateCourse(
      patchCourseRequest(course.id, { instructorId: fahd.id }),
      course.id,
    );
    expect(res.status).toBe(200);

    expect(await activeInstructorIds(course.id)).toEqual([abdallah.id, fahd.id]);
  });

  it("hands the primary column to a remaining instructor when the primary is removed", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);
    const primaryRow = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: abdallah.id },
    });

    const result = await deactivateEnrollment(course.id, primaryRow.id);
    expect(result.status).toBe("204");

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    // Must not be left pointing at someone who no longer teaches the course.
    expect(updated?.instructorId).toBe(mostafa.id);
    expect(await activeInstructorIds(course.id)).toEqual([mostafa.id]);
  });

  it("leaves the primary column alone when a non-primary instructor is removed", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);
    const extra = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: mostafa.id },
    });

    await deactivateEnrollment(course.id, extra.id);

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    expect(updated?.instructorId).toBe(abdallah.id);
  });

  // #1840 review: "Add instructors" is a plain enrollments POST and used to
  // leave a headless course headless — an active instructor on the Staff tab
  // while `course.instructor` stayed null everywhere it is read.
  it("claims the vacant primary column for the first instructor added", async () => {
    const course = await seedHeadlessCourse();
    expect(course.instructorId).toBeNull();

    const result = await addEnrollment(
      course.id,
      { userId: abdallah.id, role: "INSTRUCTOR" },
      ADMIN_RANK,
    );
    expect(result.status).toBe("201");

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    expect(updated?.instructorId).toBe(abdallah.id);
  });

  it("does not move the primary column when a second instructor joins a headed course", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    expect(updated?.instructorId).toBe(abdallah.id);
  });

  // #1840 review: removal is not the only way to stop being an instructor.
  it("hands the primary column over when the primary is demoted to TA", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);
    const primaryRow = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: abdallah.id },
    });

    const result = await updateEnrollmentRole(course.id, primaryRow.id, { role: "TA" });
    expect(result.status).toBe("200");

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    // Must not be left naming someone who is now a TA.
    expect(updated?.instructorId).toBe(mostafa.id);
    expect(await activeInstructorIds(course.id)).toEqual([mostafa.id]);
  });

  it("leaves the primary column alone when a non-primary instructor is demoted", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);
    await addEnrollment(course.id, { userId: mostafa.id, role: "INSTRUCTOR" }, ADMIN_RANK);
    const extra = await prisma.enrollment.findFirstOrThrow({
      where: { courseId: course.id, userId: mostafa.id },
    });

    await updateEnrollmentRole(course.id, extra.id, { role: "TA" });

    const updated = await prisma.course.findUnique({ where: { id: course.id } });
    expect(updated?.instructorId).toBe(abdallah.id);
  });
});

describe("#1840 — the instructor candidate picker", () => {
  function candidateRequest(courseId: string, params: Record<string, string>) {
    const search = new URLSearchParams({ courseId, page: "1", pageSize: "25", ...params });
    return new Request(`http://localhost/api/users?${search}`, { method: "GET" });
  }

  it("offers ADMIN accounts, not only platform-role INSTRUCTORs", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    mockSession(admin);
    const res = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
        isActive: "true",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((row: { id: string }) => row.id);
    // #1782: an ADMIN account must be assignable as a course instructor.
    expect(ids).toContain(mostafa.id);
    expect(ids).toContain(fahd.id);
  });

  it("excludes users who already hold an active instructor enrollment here", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    mockSession(admin);
    const res = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
        isActive: "true",
      }),
    );

    const body = await res.json();
    const ids = body.data.map((row: { id: string }) => row.id);
    expect(ids).not.toContain(abdallah.id);
  });

  it("never returns students, whatever the caller asks for", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    mockSession(admin);
    const res = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR,STUDENT",
        isActive: "true",
      }),
    );

    // Widening the role list past the staff set is a contract violation, not a
    // filter to silently narrow — otherwise this becomes a user directory.
    expect(res.status).toBe(400);
  });

  it("denies a course INSTRUCTOR, who cannot add instructors anyway", async () => {
    const course = await seedCourseWithInstructor(abdallah.id);

    mockSession(abdallah);
    const res = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
        isActive: "true",
      }),
    );

    // rank 2 < requiredRankForEnrollmentRole("INSTRUCTOR") === 3.
    expect(res.status).toBe(403);
  });

  it("allows a UNIT_ADMIN inside their authorized units and denies one outside", async () => {
    const inUnit = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    const outOfUnit = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["MATH"] });
    userIds.push(inUnit.id, outOfUnit.id);
    const course = await seedCourseWithInstructor(abdallah.id, "COSC");

    mockSession(inUnit);
    const allowed = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
        isActive: "true",
      }),
    );
    expect(allowed.status).toBe(200);

    mockSession(outOfUnit);
    const denied = await handleUsersApiRequest(
      candidateRequest(course.id, {
        exclude: "instructor",
        role: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
        isActive: "true",
      }),
    );
    expect(denied.status).toBe(403);
  });
});

// #1964: the second instructor is a full instructor, not a lesser co-owner —
// every check keys on their own enrollment, never on `Course.instructorId`.
describe("#1964 — both instructors of one section get the same access", () => {
  const SERVICE_KEY = "multi-instructor-service-key";
  beforeEach(() => {
    vi.stubEnv("EDUAI_API_KEY", SERVICE_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function courseWithTwoInstructors() {
    const course = await seedCourseWithInstructor(abdallah.id);
    await prisma.enrollment.create({
      data: { courseId: course.id, userId: fahd.id, role: "INSTRUCTOR", isActive: true },
    });
    return course;
  }

  it("gives the non-primary instructor the instructor tier on the course", async () => {
    const course = await courseWithTwoInstructors();

    for (const user of [abdallah, fahd]) {
      const { access } = await resolveCourseAccessGate(user, course.id);
      expect(access).toMatchObject({ level: "instructor", rank: INSTRUCTOR_RANK });
    }
  });

  it("lists the course for both instructors", async () => {
    const course = await courseWithTwoInstructors();

    for (const user of [abdallah, fahd]) {
      const { courses } = await listCoursesForUser(user, { pageSize: 100 });
      expect(courses.map((c) => c.id)).toContain(course.id);
    }
  });

  // #1991 review: the primary is whoever `Course.instructorId` names, which need
  // not be the first enrolled. Here the later-enrolled instructor is the primary,
  // so the test can tell "longest-standing first" from "primary first".
  it("names both instructors, longest-standing first, flagging the primary", async () => {
    const course = await courseWithTwoInstructors();
    await prisma.course.update({ where: { id: course.id }, data: { instructorId: fahd.id } });

    const instructors = (await getCourseInstructors([course.id])).get(course.id) ?? [];
    expect(instructors.map((i) => [i.id, i.isPrimary])).toEqual([
      [abdallah.id, false],
      [fahd.id, true],
    ]);
  });

  // #1991 review: AI Tutor and Question Maker authorize each request with the
  // single-user lookup (`?userId=`), not the full roster, so that is what is
  // checked for both instructors, through the route and the service key.
  it("authorizes both instructors through the lookup the extensions call", async () => {
    const course = await courseWithTwoInstructors();

    for (const user of [abdallah, fahd]) {
      const res = await enrollmentsLoader({
        request: new Request(
          `http://localhost/api/courses/${course.id}/enrollments?userId=${user.id}`,
          { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
        ),
        params: { id: course.id },
        context: {},
      } as unknown as Parameters<typeof enrollmentsLoader>[0]);
      expect(res.status).toBe(200);
      expect((await res.json()).enrollment).toMatchObject({
        studentId: user.id,
        role: "INSTRUCTOR",
        isActive: true,
      });
    }
  });

  it("includes both instructors in the sync roster for background callers", async () => {
    const course = await courseWithTwoInstructors();

    const instructors = (await getCourseEnrollments(course.id))
      .filter((e) => e.role === "INSTRUCTOR" && e.isActive)
      .map((e) => e.userId);
    expect(instructors).toEqual(expect.arrayContaining([abdallah.id, fahd.id]));
  });
});
