// @vitest-environment node
//
// Integration tests for /api/courses.
// Uses the test database configured in apps/core/.env.test

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { handleCourseRequest } from "~/lib/courses/server";
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
  it("returns 200 with a courses array", async () => {
    const res = await handleCourseRequest(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("courses");
    expect(Array.isArray(body.courses)).toBe(true);
  });

  it("includes the seeded course in the response", async () => {
    const res = await handleCourseRequest(makeGetRequest());

    const body = await res.json();
    const found = body.courses.find((c: { id: string }) => c.id === courseId);
    expect(found).toBeDefined();
    expect(found.name).toBe("Integration Test Course");
    expect(found.code).toBe("INT 999");
  });

  it("requires no session — unauthenticated callers still get 200", async () => {
    const res = await handleCourseRequest(makeGetRequest());
    expect(res.status).toBe(200);
  });
});

