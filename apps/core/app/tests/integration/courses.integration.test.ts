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

let professorId: string;
let adminId: string;
let courseId: string;
const createdCourseIds: string[] = [];

beforeAll(async () => {
  const professor = await prisma.user.create({
    data: {
      email: "integration-courses-test@example.com",
      name: "Integration Professor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  professorId = professor.id;
  INSTRUCTOR_SESSION.user.id = professorId;

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
    data: { courseId, userId: professorId, role: "INSTRUCTOR" },
  });
});

afterAll(async () => {
  if (createdCourseIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  }
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: { in: [professorId, adminId] } } });
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

  it("returns 403 when caller is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(403);
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
  it("returns 403 when caller is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "Forbidden Course",
      code: "FB 001",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: "2025-09-01",
      instructorUserIds: professorId,
    }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "No Code Course",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "Invalid input");
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
      instructorUserIds: professorId,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("Transaction Test Course");
    createdCourseIds.push(body.id);

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: body.id, userId: professorId, role: "INSTRUCTOR", isActive: true },
    });
    expect(enrollment).not.toBeNull();
  });
});

