import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourse: vi.fn(),
}));

vi.mock("~/lib/courses/enrollments.server", () => ({
  getCourseEnrollments: vi.fn(),
  addEnrollment: vi.fn(),
}));

import { loader, action } from "~/routes/api/courses.enrollments";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getCourse } from "~/lib/courses/server";
import { getCourseEnrollments, addEnrollment } from "~/lib/courses/enrollments.server";

const VALID_KEY = "test-service-key";

const MOCK_ENROLLMENTS = [
  {
    id: "enroll-1",
    userId: "user-1",
    user: { email: "alice@test.com", name: "Alice", studentId: "student_1" },
    enrolledAt: new Date("2025-09-01T00:00:00.000Z"),
    isActive: true,
    role: "STUDENT",
  },
  {
    id: "enroll-2",
    userId: "user-2",
    user: { email: "bob@test.com", name: "Bob", studentId: null },
    enrolledAt: new Date("2025-09-02T00:00:00.000Z"),
    isActive: false,
    role: "TA",
  },
  {
    id: "enroll-3",
    userId: "user-3",
    user: { email: "carol@test.com", name: "Carol", studentId: null },
    enrolledAt: null,
    isActive: true,
    role: "INSTRUCTOR",
  },
];

const MOCK_COURSE = {
  id: "course-1",
  name: "Algorithms",
  code: "COSC 101",
  isPublished: true,
  deletedAt: null,
};

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = MOCK_COURSE) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function makeArgs(id?: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${id ?? ""}/enrollments`, {
      headers,
    }),
    params: id !== undefined ? { id } : {},
    context: {} as never,
  };
}

function makePost(id: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/courses/${id}/enrollments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
    context: {} as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
  vi.mocked(getCourse).mockResolvedValue(MOCK_COURSE as never);
  vi.mocked(getCourseEnrollments).mockResolvedValue(MOCK_ENROLLMENTS as never);
  mockAccess({ level: "instructor", rank: 2 });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/courses/:id/enrollments loader", () => {
  // --- 400 ---
  it("returns 400 when id param is missing", async () => {
    const res = await loader(makeArgs() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  // --- 401 ---
  it("returns 401 when no Bearer header and no session", async () => {
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  // --- 403 service key ---
  it("returns 403 when Bearer token fails requireServiceKey", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 })
    );
    const res = await loader(makeArgs("course-1", "Bearer wrong"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
    expect(getCourse).not.toHaveBeenCalled();
  });

  // --- 404 ---
  it("returns 404 COURSE_NOT_FOUND when course does not exist (service key)", async () => {
    vi.mocked(getCourse).mockResolvedValue(null);
    const res = await loader(makeArgs("missing", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND when course does not exist (user auth)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-1", role: "STUDENT" },
    } as never);
    mockAccess(null, null);
    const res = await loader(makeArgs("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  // --- 403 user paths (§6) ---
  it("returns 403 when user-auth caller has no course relationship", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "outsider", role: "STUDENT" },
    } as never);
    mockAccess(null);
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(403);
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  it("returns 403 for an enrolled STUDENT (#305 — students cannot see peers)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-1", role: "STUDENT" },
    } as never);
    mockAccess({ level: "student", rank: 0 });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(403);
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  // --- 200 service key ---
  it("returns 200 with enrollments via service key (skips RBAC entirely)", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  // --- 200 user auth (TA and up) ---
  it("returns 200 when user-auth caller is enrolled as TA", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-2", role: "STUDENT" },
    } as never);
    mockAccess({ level: "ta", rank: 1 });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
  });

  it("returns 200 when user-auth caller is enrolled as INSTRUCTOR", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-3", role: "INSTRUCTOR" },
    } as never);
    mockAccess({ level: "instructor", rank: 2 });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
  });

  // --- Role mapping ---
  it("maps STUDENT enrollment correctly", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    const body = await res.json();
    const student = body.enrollments.find(
      (e: Record<string, unknown>) => e.role === "STUDENT"
    );
    expect(student).toEqual({
      id: "enroll-1",
      studentId: "user-1",
      studentEmail: "alice@test.com",
      studentName: "Alice",
      studentNumber: "student_1",
      enrolledAt: "2025-09-01T00:00:00.000Z",
      isActive: true,
      role: "STUDENT",
    });
  });

  it("maps INSTRUCTOR enrollment correctly with null enrolledAt", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    const body = await res.json();
    const instructor = body.enrollments.find(
      (e: Record<string, unknown>) => e.role === "INSTRUCTOR"
    );
    expect(instructor).toEqual({
      id: "enroll-3",
      studentId: "user-3",
      studentEmail: "carol@test.com",
      studentName: "Carol",
      studentNumber: null,
      enrolledAt: null,
      isActive: true,
      role: "INSTRUCTOR",
    });
  });

  // --- Returns both active and inactive ---
  it("returns both active and inactive enrollments", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    const body = await res.json();
    const activeStates = body.enrollments.map(
      (e: Record<string, unknown>) => e.isActive
    );
    expect(activeStates).toContain(true);
    expect(activeStates).toContain(false);
  });

  // --- Empty enrollments ---
  it("returns 200 with empty array when course has no enrollments (service key)", async () => {
    vi.mocked(getCourseEnrollments).mockResolvedValue([]);
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enrollments: [] });
  });
});

describe("POST /api/courses/:id/enrollments action (#305)", () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "actor", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "201",
      enrollment: { id: "e-new" },
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makePost("course-1", { userId: "u9", role: "STUDENT" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for an enrolled TA (manage tier is rank >= 2)", async () => {
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makePost("course-1", { userId: "u9", role: "STUDENT" }));
    expect(res.status).toBe(403);
    expect(addEnrollment).not.toHaveBeenCalled();
  });

  it("lets an INSTRUCTOR add a STUDENT", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    const res = await action(makePost("course-1", { userId: "u9", role: "STUDENT" }));
    expect(res.status).toBe(201);
    expect(addEnrollment).toHaveBeenCalledWith("course-1", { userId: "u9", role: "STUDENT" });
  });

  it("lets an INSTRUCTOR add a TA", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    const res = await action(makePost("course-1", { userId: "u9", role: "TA" }));
    expect(res.status).toBe(201);
  });

  it("blocks an INSTRUCTOR from adding another INSTRUCTOR (§6)", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    const res = await action(makePost("course-1", { userId: "u9", role: "INSTRUCTOR" }));
    expect(res.status).toBe(403);
    expect(addEnrollment).not.toHaveBeenCalled();
  });

  it("lets UNIT_ADMIN add an INSTRUCTOR", async () => {
    mockAccess({ level: "unit", rank: 3 });
    const res = await action(makePost("course-1", { userId: "u9", role: "INSTRUCTOR" }));
    expect(res.status).toBe(201);
  });

  it("returns 409 ALREADY_ENROLLED on duplicate", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "409",
      error: "ALREADY_ENROLLED",
    } as never);
    const res = await action(makePost("course-1", { userId: "u9", role: "STUDENT" }));
    expect(res.status).toBe(409);
  });

  it("returns 422 USER_NOT_FOUND for unknown user", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(addEnrollment).mockResolvedValue({
      status: "422",
      error: "USER_NOT_FOUND",
    } as never);
    const res = await action(makePost("course-1", { userId: "ghost", role: "STUDENT" }));
    expect(res.status).toBe(422);
  });

  it("returns 404 when the course does not exist", async () => {
    mockAccess(null, null);
    const res = await action(makePost("missing", { userId: "u9", role: "STUDENT" }));
    expect(res.status).toBe(404);
  });
});
