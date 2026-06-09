import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourse: vi.fn(),
}));

vi.mock("~/lib/courses/enrollments.server", () => ({
  getCourseEnrollments: vi.fn(),
}));

import { loader } from "~/routes/api/courses.enrollments";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { getCourse } from "~/lib/courses/server";
import { getCourseEnrollments } from "~/lib/courses/enrollments.server";

const VALID_KEY = "test-service-key";

const MOCK_ENROLLMENTS = [
  {
    userId: "user-1",
    user: { email: "alice@test.com", name: "Alice" },
    enrolledAt: new Date("2025-09-01T00:00:00.000Z"),
    isActive: true,
    role: "STUDENT",
  },
  {
    userId: "user-2",
    user: { email: "bob@test.com", name: "Bob" },
    enrolledAt: new Date("2025-09-02T00:00:00.000Z"),
    isActive: false,
    role: "TA",
  },
  {
    userId: "user-3",
    user: { email: "carol@test.com", name: "Carol" },
    enrolledAt: null,
    isActive: true,
    role: "INSTRUCTOR",
  },
];

const MOCK_COURSE = {
  id: "course-1",
  name: "Algorithms",
  code: "COSC 101",
  deletedAt: null,
};

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

describe("GET /api/courses/:id/enrollments loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(getCourse).mockResolvedValue(MOCK_COURSE as never);
    vi.mocked(getCourseEnrollments).mockResolvedValue(MOCK_ENROLLMENTS as never);
  });

  afterEach(() => vi.unstubAllEnvs());

  // --- 400 ---
  it("returns 400 when id param is missing", async () => {
    const res = await loader(makeArgs() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(getCourse).not.toHaveBeenCalled();
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  // --- 401 ---
  it("returns 401 when no Bearer header and no session", async () => {
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getCourse).not.toHaveBeenCalled();
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
    vi.mocked(getCourse).mockResolvedValue(null);
    const res = await loader(makeArgs("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(getCourseEnrollments).not.toHaveBeenCalled();
  });

  // --- 403 user not enrolled ---
  it("returns 403 when user-auth caller is not enrolled in the course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "outsider", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not enrolled/i);
    expect(getCourseEnrollments).toHaveBeenCalledWith("course-1");
  });

  // --- 200 service key ---
  it("returns 200 with enrollments via service key (skips enrollment check)", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  // --- 200 user auth (enrolled student) ---
  it("returns 200 when user-auth caller is enrolled as STUDENT", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-1", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrollments).toHaveLength(3);
  });

  // --- 200 user auth (instructor) ---
  it("returns 200 when user-auth caller is enrolled as INSTRUCTOR", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user-3", role: "INSTRUCTOR" },
    } as never);
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
      studentId: "user-1",
      studentEmail: "alice@test.com",
      studentName: "Alice",
      enrolledAt: "2025-09-01T00:00:00.000Z",
      isActive: true,
      role: "STUDENT",
    });
  });

  it("maps TA enrollment correctly", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    const body = await res.json();
    const ta = body.enrollments.find(
      (e: Record<string, unknown>) => e.role === "TA"
    );
    expect(ta).toEqual({
      studentId: "user-2",
      studentEmail: "bob@test.com",
      studentName: "Bob",
      enrolledAt: "2025-09-02T00:00:00.000Z",
      isActive: false,
      role: "TA",
    });
  });

  it("maps INSTRUCTOR enrollment correctly with null enrolledAt", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    const body = await res.json();
    const instructor = body.enrollments.find(
      (e: Record<string, unknown>) => e.role === "INSTRUCTOR"
    );
    expect(instructor).toEqual({
      studentId: "user-3",
      studentEmail: "carol@test.com",
      studentName: "Carol",
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
