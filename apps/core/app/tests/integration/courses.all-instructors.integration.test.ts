// @vitest-environment node
//
// #1841 — a course with three instructors must show three, everywhere a course
// is displayed. Uses the test database configured in apps/core/.env.test.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { seedTestDisciplines } from "../helpers/disciplines";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCourseInstructors } from "~/lib/courses/instructors.server";
import { loader as courseDetailApiLoader } from "~/routes/api/courses.id";
import { loader as courseDetailPageLoader } from "~/routes/courses.$courseId";
import { auth } from "~/lib/auth/server";
import { seedUser, enroll, mockSession, type SeededUser } from "../helpers/rbac";

let admin: SeededUser;
let student: SeededUser;
let abdallah: SeededUser;
let mostafa: SeededUser;
let fahd: SeededUser;
let removed: SeededUser;
let courseId: string;
const courseIds: string[] = [];
const userIds: string[] = [];

function apiArgs(id: string) {
  return {
    request: new Request(`http://localhost/api/courses/${id}`, { method: "GET" }),
    params: { id },
    context: {},
  } as never;
}

function pageArgs(id: string) {
  return {
    request: new Request(`http://localhost/courses/${id}`, { method: "GET" }),
    params: { courseId: id },
    context: {},
  } as never;
}

beforeAll(async () => {
  await seedTestDisciplines();
  admin = await seedUser({ role: "ADMIN", name: "All Instructors Admin" });
  student = await seedUser({ role: "STUDENT", name: "Enrolled Student" });
  abdallah = await seedUser({ role: "INSTRUCTOR", name: "Dr Abdallah" });
  // Deliberately an ADMIN account holding an instructor enrollment (#1782).
  mostafa = await seedUser({ role: "ADMIN", name: "Dr Mostafa" });
  fahd = await seedUser({ role: "INSTRUCTOR", name: "Fahd" });
  removed = await seedUser({ role: "INSTRUCTOR", name: "Departed Instructor" });
  userIds.push(admin.id, student.id, abdallah.id, mostafa.id, fahd.id, removed.id);

  const suffix = randomUUID().slice(0, 8);
  const course = await prisma.course.create({
    data: {
      name: `Three Instructors ${suffix}`,
      code: `TI ${suffix}`,
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
      department: "COSC",
      isPublished: true,
      // Only one of the three is the primary.
      instructorId: abdallah.id,
    },
  });
  courseId = course.id;
  courseIds.push(course.id);

  await enroll(courseId, abdallah.id, "INSTRUCTOR");
  await enroll(courseId, mostafa.id, "INSTRUCTOR");
  await enroll(courseId, fahd.id, "INSTRUCTOR");
  await enroll(courseId, removed.id, "INSTRUCTOR", false);
  await enroll(courseId, student.id, "STUDENT");
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

describe("getCourseInstructors", () => {
  it("returns every active instructor for a course, in enrollment order", async () => {
    const byCourse = await getCourseInstructors([courseId]);
    const names = (byCourse.get(courseId) ?? []).map((row) => row.name);
    expect(names).toEqual(["Dr Abdallah", "Dr Mostafa", "Fahd"]);
  });

  it("omits deactivated instructors", async () => {
    const byCourse = await getCourseInstructors([courseId]);
    const emails = (byCourse.get(courseId) ?? []).map((row) => row.email);
    expect(emails).not.toContain(removed.email);
  });

  it("marks exactly the Course.instructorId row as primary", async () => {
    const byCourse = await getCourseInstructors([courseId]);
    const instructors = byCourse.get(courseId) ?? [];
    expect(instructors.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([abdallah.id]);
  });

  it("resolves several courses in one call, and omits ones with no instructor", async () => {
    const empty = await prisma.course.create({
      data: {
        name: "No instructors",
        code: `NI ${randomUUID().slice(0, 8)}`,
        section: "001",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-09-01"),
      },
    });
    courseIds.push(empty.id);

    const byCourse = await getCourseInstructors([courseId, empty.id]);
    expect(byCourse.get(courseId)).toHaveLength(3);
    expect(byCourse.get(empty.id)).toBeUndefined();
  });

  it("returns an empty map for no course ids rather than querying for all", async () => {
    expect((await getCourseInstructors([])).size).toBe(0);
  });
});

describe("#1841 — GET /api/courses/:id", () => {
  it("returns all three instructors to staff, and keeps the legacy single field", async () => {
    mockSession(admin);
    const res = (await courseDetailApiLoader(apiArgs(courseId))) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.instructors.map((row: { name: string }) => row.name)).toEqual([
      "Dr Abdallah",
      "Dr Mostafa",
      "Fahd",
    ]);
    // Back-compat for the extensions that read `instructor`.
    expect(body.instructor).toMatchObject({ name: "Dr Abdallah" });
  });

  it("returns all three instructors to an enrolled student too", async () => {
    mockSession(student);
    const res = (await courseDetailApiLoader(apiArgs(courseId))) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.instructors).toHaveLength(3);
    expect(body.instructor).toMatchObject({ name: "Dr Abdallah" });
  });

  it("does not leak instructor emails to a student", async () => {
    // The staff roster withholds contact PII from students elsewhere; the
    // instructor list must not become a way around that.
    mockSession(student);
    const res = (await courseDetailApiLoader(apiArgs(courseId))) as Response;
    const body = await res.json();

    for (const row of body.instructors) {
      expect(row.email).toBeNull();
    }
  });

  it("still exposes emails to staff, who rely on them", async () => {
    mockSession(admin);
    const res = (await courseDetailApiLoader(apiArgs(courseId))) as Response;
    const body = await res.json();

    expect(body.instructors.map((row: { email: string | null }) => row.email)).toContain(
      abdallah.email,
    );
  });
});

describe("#1841 — the course detail page loader", () => {
  it("hands every instructor to the manager view, not just the primary", async () => {
    mockSession(admin);
    const result = (await courseDetailPageLoader(pageArgs(courseId))) as unknown as {
      course: { instructors: { name: string }[]; instructor: { name: string } | null };
    };

    expect(result.course.instructors.map((row) => row.name)).toEqual([
      "Dr Abdallah",
      "Dr Mostafa",
      "Fahd",
    ]);
    expect(result.course.instructor).toMatchObject({ name: "Dr Abdallah" });
  });

  it("hands every instructor to the student view as well", async () => {
    mockSession(student);
    const result = (await courseDetailPageLoader(pageArgs(courseId))) as unknown as {
      course: { instructors: { name: string; email: string | null }[] };
    };

    expect(result.course.instructors).toHaveLength(3);
    // Same PII boundary as the API.
    expect(result.course.instructors.every((row) => row.email === null)).toBe(true);
  });
});
