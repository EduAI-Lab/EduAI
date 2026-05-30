// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader } from "~/routes/api/courses.enrollments";
import { auth } from "~/lib/auth/server";

const VALID_SERVICE_KEY = "enrollments-integration-service-key";

let courseId: string;
let studentId: string;
let taId: string;
let instructorId: string;
let outsiderId: string;

beforeAll(async () => {
  vi.stubEnv("EDUAI_API_KEY", VALID_SERVICE_KEY);

  // Create users
  const student = await prisma.user.create({
    data: {
      email: "enroll-student@test.com",
      name: "Enroll Student",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  studentId = student.id;

  const ta = await prisma.user.create({
    data: {
      email: "enroll-ta@test.com",
      name: "Enroll TA",
      role: "TA",
      emailVerified: false,
    },
  });
  taId = ta.id;

  const instructor = await prisma.user.create({
    data: {
      email: "enroll-instructor@test.com",
      name: "Enroll Instructor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  instructorId = instructor.id;

  const outsider = await prisma.user.create({
    data: {
      email: "enroll-outsider@test.com",
      name: "Outsider",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  outsiderId = outsider.id;

  // Create course
  const course = await prisma.course.create({
    data: {
      name: "Enrollments Test Course",
      code: "ENR 101",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;

  // Create enrollments
  await prisma.enrollment.createMany({
    data: [
      {
        courseId,
        userId: studentId,
        role: "STUDENT",
        isActive: true,
        enrolledAt: new Date("2025-09-01"),
      },
      {
        courseId,
        userId: taId,
        role: "TA",
        isActive: false,
        enrolledAt: new Date("2025-09-02"),
      },
      {
        courseId,
        userId: instructorId,
        role: "INSTRUCTOR",
        isActive: true,
        enrolledAt: new Date("2025-08-15"),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({
    where: { id: { in: [studentId, taId, instructorId, outsiderId] } },
  });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

function makeArgs(id: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${id}/enrollments`, {
      headers,
    }),
    params: { id },
    context: {} as never,
  };
}

describe("GET /api/courses/:id/enrollments (integration)", () => {
  // --- Auth ---
  it("returns 401 when no session is present", async () => {
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 INVALID_SERVICE_KEY for wrong Bearer token", async () => {
    const res = await loader(makeArgs(courseId, "Bearer wrong-key"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
  });

  // --- 404 ---
  it("returns 404 for nonexistent course (service key)", async () => {
    const res = await loader(
      makeArgs("nonexistent-id", `Bearer ${VALID_SERVICE_KEY}`)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 404 for nonexistent course (user auth)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: studentId, role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs("nonexistent-id"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  // --- 403 not enrolled ---
  it("returns 403 when user-auth caller is not enrolled", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: outsiderId, role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not enrolled/i);
  });

  // --- 200 service key ---
  it("returns all enrollments via service key", async () => {
    const res = await loader(
      makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);

    // Verify response shape
    for (const e of body.enrollments) {
      expect(e).toHaveProperty("studentId");
      expect(e).toHaveProperty("studentEmail");
      expect(e).toHaveProperty("studentName");
      expect(e).toHaveProperty("enrolledAt");
      expect(e).toHaveProperty("isActive");
      expect(e).toHaveProperty("role");
    }

    // Verify session was never checked
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  // --- 200 user auth (enrolled student) ---
  it("returns all enrollments when caller is an enrolled student", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: studentId, role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
  });

  // --- 200 user auth (instructor) ---
  it("returns all enrollments when caller is an enrolled instructor", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: instructorId, role: "INSTRUCTOR" },
    } as never);
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
  });

  // --- Role mapping from real DB ---
  it("maps all three roles correctly from real DB data", async () => {
    const res = await loader(
      makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`)
    );
    const body = await res.json();
    const roles = body.enrollments.map((e: Record<string, unknown>) => e.role);
    expect(roles).toContain("STUDENT");
    expect(roles).toContain("TA");
    expect(roles).toContain("INSTRUCTOR");
  });

  // --- Active and inactive ---
  it("returns both active and inactive enrollments", async () => {
    const res = await loader(
      makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`)
    );
    const body = await res.json();
    const activeStates = body.enrollments.map(
      (e: Record<string, unknown>) => e.isActive
    );
    expect(activeStates).toContain(true);
    expect(activeStates).toContain(false);
  });

  // --- Correct field values ---
  it("returns correct student data from real DB", async () => {
    const res = await loader(
      makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`)
    );
    const body = await res.json();
    const student = body.enrollments.find(
      (e: Record<string, unknown>) => e.studentId === studentId
    );
    expect(student).toBeDefined();
    expect(student.studentEmail).toBe("enroll-student@test.com");
    expect(student.studentName).toBe("Enroll Student");
    expect(student.isActive).toBe(true);
    expect(student.role).toBe("STUDENT");
    expect(student.enrolledAt).toBe("2025-09-01T00:00:00.000Z");
  });

  it("returns inactive TA with correct data", async () => {
    const res = await loader(
      makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`)
    );
    const body = await res.json();
    const ta = body.enrollments.find(
      (e: Record<string, unknown>) => e.studentId === taId
    );
    expect(ta).toBeDefined();
    expect(ta.studentEmail).toBe("enroll-ta@test.com");
    expect(ta.isActive).toBe(false);
    expect(ta.role).toBe("TA");
  });
});
