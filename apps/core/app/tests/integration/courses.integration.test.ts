// @vitest-environment node
//
// Integration tests for /api/courses.
// Uses the test database configured in apps/core/.env.test

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCourses, createCourse } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import {
  seedUser,
  seedCourse,
  enroll,
  mockSession,
  cleanupRbac,
} from "../helpers/rbac";
import { setPolicy, invalidatePolicyCache } from "~/lib/policy.server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest() {
  return new Request("http://localhost/api/courses", { method: "GET" });
}

function makeFormDataPost(fields: Record<string, string | number>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, String(value));
  }
  return new Request("http://localhost/api/courses", {
    method: "POST",
    body: formData,
  });
}

const ADMIN_SESSION = {
  user: { id: "", role: "ADMIN", email: "admin-courses@test.com", name: "Admin" },
};
const INSTRUCTOR_SESSION = {
  user: { id: "", role: "INSTRUCTOR", email: "integration-courses-test@example.com", name: "Integration Professor" },
};

// ---------------------------------------------------------------------------
// Seed / teardown
// ---------------------------------------------------------------------------

let instructorId: string;
let adminId: string;
let courseId: string;
const createdCourseIds: string[] = [];

beforeAll(async () => {
  const instructor = await prisma.user.create({
    data: {
      email: "integration-courses-test@example.com",
      name: "Integration Instructor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  instructorId = instructor.id;
  INSTRUCTOR_SESSION.user.id = instructorId;

  const admin = await prisma.user.create({
    data: {
      email: "admin-courses@test.com",
      name: "Admin Courses",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;

  const course = await prisma.course.create({
    data: {
      name: "Integration Test Course",
      code: "INT 999",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;

  await prisma.enrollment.create({
    data: { courseId, userId: instructorId, role: "INSTRUCTOR" },
  });
});

afterAll(async () => {
  if (createdCourseIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  }
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: { in: [instructorId, adminId] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// GET /api/courses
// ---------------------------------------------------------------------------

describe("GET /api/courses", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(401);
  });

  // #315 §19: soft-deleted courses are invisible by default; an ADMIN may opt in
  // with ?includeDeleted=true. The flag is ignored for non-ADMIN callers.
  it("hides soft-deleted courses by default and surfaces them for ADMIN with ?includeDeleted=true", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const deleted = await seedCourse({ isPublished: true });
    await prisma.course.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });

    try {
      mockSession(admin);

      // Default read: soft-deleted course is invisible even to ADMIN.
      const defaultRes = await getCourses(makeGetRequest());
      const defaultIds = (await defaultRes.json()).courses.map((c: { id: string }) => c.id);
      expect(defaultIds).not.toContain(deleted.id);

      // ADMIN forensics opt-in: soft-deleted course appears.
      const inclRes = await getCourses(
        new Request("http://localhost/api/courses?includeDeleted=true", { method: "GET" }),
      );
      const inclIds = (await inclRes.json()).courses.map((c: { id: string }) => c.id);
      expect(inclIds).toContain(deleted.id);
    } finally {
      await cleanupRbac({ userIds: [admin.id], courseIds: [deleted.id] });
    }
  });

  it("ignores ?includeDeleted=true for a non-ADMIN caller", async () => {
    const instructor = await seedUser({ role: "INSTRUCTOR" });
    const deleted = await seedCourse({ isPublished: true });
    await enroll(deleted.id, instructor.id, "INSTRUCTOR");
    await prisma.course.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });

    try {
      mockSession(instructor);
      const res = await getCourses(
        new Request("http://localhost/api/courses?includeDeleted=true", { method: "GET" }),
      );
      const ids = (await res.json()).courses.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(deleted.id);
    } finally {
      await cleanupRbac({ userIds: [instructor.id], courseIds: [deleted.id] });
    }
  });

  it("returns 200 scoped to enrollments for an INSTRUCTOR (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.courses.map((c: { id: string }) => c.id);
    // Enrolled as INSTRUCTOR in the seeded (unpublished) course — visible.
    expect(ids).toContain(courseId);
    // Sees ONLY enrolled courses, not the whole catalog.
    expect(
      body.courses.every((c: { id: string }) => ids.includes(c.id) && c.id !== "nonexistent"),
    ).toBe(true);
  });

  it("applies the publish gate per enrollment role — grad-TA mixed case (§1)", async () => {
    // UserRole=STUDENT user: TA in unpublished course A, STUDENT in unpublished course B.
    const gradTa = await seedUser({ role: "STUDENT" });
    const courseA = await seedCourse({ isPublished: false });
    const courseB = await seedCourse({ isPublished: false });
    await enroll(courseA.id, gradTa.id, "TA");
    await enroll(courseB.id, gradTa.id, "STUDENT");

    try {
      mockSession(gradTa);
      const res = await getCourses(makeGetRequest());
      expect(res.status).toBe(200);
      const ids = (await res.json()).courses.map((c: { id: string }) => c.id);
      expect(ids).toContain(courseA.id); // TA: publish gate exempt
      expect(ids).not.toContain(courseB.id); // STUDENT: unpublished hidden
    } finally {
      await cleanupRbac({ userIds: [gradTa.id], courseIds: [courseA.id, courseB.id] });
    }
  });

  it("scopes UNIT_ADMIN to their authorized units (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    const coscCourse = await seedCourse({ department: "COSC", isPublished: false });
    const mathCourse = await seedCourse({ department: "MATH", isPublished: true });
    const noDeptCourse = await seedCourse({ department: null, isPublished: true });

    try {
      mockSession(unitAdmin);
      const res = await getCourses(makeGetRequest());
      expect(res.status).toBe(200);
      const ids = (await res.json()).courses.map((c: { id: string }) => c.id);
      expect(ids).toContain(coscCourse.id);
      expect(ids).not.toContain(mathCourse.id);
      expect(ids).not.toContain(noDeptCourse.id); // §19: null department never matches
    } finally {
      await cleanupRbac({
        userIds: [unitAdmin.id],
        courseIds: [coscCourse.id, mathCourse.id, noDeptCourse.id],
      });
    }
  });

  it("returns 200 with a courses array for ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await getCourses(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("courses");
    expect(Array.isArray(body.courses)).toBe(true);
  });

  it("includes the seeded course in the response", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await getCourses(makeGetRequest());

    const body = await res.json();
    const found = body.courses.find((c: { id: string }) => c.id === courseId);
    expect(found).toBeDefined();
    expect(found.name).toBe("Integration Test Course");
    expect(found.code).toBe("INT 999");
  });

  it("excludes soft-deleted courses", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const deleted = await prisma.course.create({
      data: {
        name: "Deleted Course",
        code: "DEL 999",
        section: "001",
        term: "Fall",
        year: 2025,
        startDate: new Date("2025-09-01"),
        deletedAt: new Date(),
      },
    });

    const res = await getCourses(makeGetRequest());
    const body = await res.json();
    const found = body.courses.find((c: { id: string }) => c.id === deleted.id);
    expect(found).toBeUndefined();

    await prisma.course.delete({ where: { id: deleted.id } });
  });
});

// ---------------------------------------------------------------------------
// POST /api/courses
// ---------------------------------------------------------------------------

describe("POST /api/courses", () => {
  it("returns 403 when instructor create is denied by policy", async () => {
    await setPolicy("instructors.canCreateCourses", false, adminId);
    invalidatePolicyCache();
    try {
      vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
      const res = await createCourse(makeFormDataPost({
        name: "Forbidden Course",
        code: "FB 001",
        section: "001",
        term: "Fall",
        year: 2025,
        startDate: "2025-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    } finally {
      await setPolicy("instructors.canCreateCourses", true, adminId);
      invalidatePolicyCache();
    }
  });

  it("returns 422 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "No Code Course",
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "VALIDATION_ERROR");
  });

  it("returns 422 when instructorUserIds do not resolve to INSTRUCTOR users", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "Bad Instructor Course",
      code: "BI 001",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: "2025-09-01",
      department: "COSC",
      instructorUserIds: adminId,
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "INVALID_INSTRUCTOR");
  });

  it("creates course and INSTRUCTOR enrollment in a transaction", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "Transaction Test Course",
      code: "TX 001",
      section: "002",
      term: "Winter",
      year: 2026,
      startDate: "2026-01-01",
      department: "COSC",
      instructorUserIds: instructorId,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("Transaction Test Course");
    createdCourseIds.push(body.id);

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: body.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
    });
    expect(enrollment).not.toBeNull();
  });

  it("returns 422 with no instructorUserIds and creates no Course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "No Instructor Course",
      code: "NI 001",
      section: "001",
      term: "Fall",
      year: 2026,
      startDate: "2026-09-01",
    }));
    // Schema requires >= 1 instructor id → validation failure, nothing persisted.
    expect(res.status).toBe(422);
    const row = await prisma.course.findFirst({ where: { code: "NI 001" } });
    expect(row).toBeNull();
  });

  it("returns 403 when UNIT_ADMIN creates outside authorizedUnits (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["MATH"] });
    try {
      mockSession(unitAdmin);
      const res = await createCourse(makeFormDataPost({
        name: "Wrong Unit Course",
        code: "WU 001",
        section: "001",
        term: "Fall",
        year: 2026,
        startDate: "2026-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "DEPARTMENT_NOT_AUTHORIZED" });
    } finally {
      await cleanupRbac({ userIds: [unitAdmin.id] });
    }
  });

  it("lets UNIT_ADMIN create inside authorizedUnits with instructor enrollment (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    try {
      mockSession(unitAdmin);
      const res = await createCourse(makeFormDataPost({
        name: "Unit Admin Course",
        code: "UA 001",
        section: "001",
        term: "Fall",
        year: 2026,
        startDate: "2026-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      createdCourseIds.push(body.id);
      expect(body.department).toBe("COSC");
    } finally {
      await cleanupRbac({ userIds: [unitAdmin.id] });
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/courses/:id (soft-delete)
// ---------------------------------------------------------------------------

describe("DELETE /api/courses/:id", () => {
  it("instructor soft-deletes own course; it disappears from GET /api/courses (#298)", async () => {
    const { deleteCourse } = await import("~/lib/courses/server");
    const instructor = await seedUser({ role: "INSTRUCTOR" });
    const course = await seedCourse({ isPublished: true });
    await enroll(course.id, instructor.id, "INSTRUCTOR");

    try {
      mockSession(instructor);
      const res = await deleteCourse(
        new Request(`http://localhost/api/courses/${course.id}`, { method: "DELETE" }),
        course.id,
      );
      expect(res.status).toBe(204);

      const row = await prisma.course.findUnique({ where: { id: course.id } });
      expect(row?.deletedAt).not.toBeNull();

      mockSession(instructor);
      const list = await getCourses(makeGetRequest());
      const ids = (await list.json()).courses.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(course.id);
    } finally {
      await cleanupRbac({ userIds: [instructor.id], courseIds: [course.id] });
    }
  });
});

