import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/courses/enrollments.server", () => ({
  getEnrollment: vi.fn(),
  updateEnrollmentRole: vi.fn(),
  deactivateEnrollment: vi.fn(),
}));

import { action } from "~/routes/api/courses.enrollments.$enrollmentId";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import {
  getEnrollment,
  updateEnrollmentRole,
  deactivateEnrollment,
} from "~/lib/courses/enrollments.server";

const COURSE = { id: "c1", isPublished: true };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessGate).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function makeArgs(method: "PATCH" | "DELETE", body?: unknown) {
  return {
    request: new Request("http://localhost/api/courses/c1/enrollments/e1", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params: { id: "c1", enrollmentId: "e1" },
    context: {} as never,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "actor", role: "INSTRUCTOR" },
  } as never);
  mockAccess({ level: "instructor", rank: 2 });
  vi.mocked(getEnrollment).mockResolvedValue({
    id: "e1", courseId: "c1", userId: "target", role: "STUDENT", isActive: true,
  } as never);
  vi.mocked(updateEnrollmentRole).mockResolvedValue({
    status: "200", enrollment: { id: "e1", role: "TA" }, previousRole: "STUDENT",
  } as never);
  vi.mocked(deactivateEnrollment).mockResolvedValue({ status: "204", role: "STUDENT" } as never);
});

describe("PATCH /api/courses/:id/enrollments/:enrollmentId (#305)", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when course is missing", async () => {
    mockAccess(null, null);
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a TA (manage tier is rank >= 2)", async () => {
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(403);
    expect(updateEnrollmentRole).not.toHaveBeenCalled();
  });

  it("returns 404 when the enrollment is not in this course", async () => {
    vi.mocked(getEnrollment).mockResolvedValue(null);
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ENROLLMENT_NOT_FOUND" });
  });

  it("lets an INSTRUCTOR promote STUDENT → TA", async () => {
    const res = await action(makeArgs("PATCH", { role: "TA" }));
    expect(res.status).toBe(200);
    expect(updateEnrollmentRole).toHaveBeenCalledWith("c1", "e1", { role: "TA" });
  });

  it("blocks an INSTRUCTOR from promoting to INSTRUCTOR (§6 — admin/unit only)", async () => {
    const res = await action(makeArgs("PATCH", { role: "INSTRUCTOR" }));
    expect(res.status).toBe(403);
    expect(updateEnrollmentRole).not.toHaveBeenCalled();
  });

  it("blocks an INSTRUCTOR from role-changing a fellow INSTRUCTOR (§6)", async () => {
    vi.mocked(getEnrollment).mockResolvedValue({
      id: "e1", courseId: "c1", userId: "peer", role: "INSTRUCTOR", isActive: true,
    } as never);
    const res = await action(makeArgs("PATCH", { role: "STUDENT" }));
    expect(res.status).toBe(403);
  });

  it("lets UNIT_ADMIN promote to INSTRUCTOR", async () => {
    mockAccess({ level: "unit", rank: 3 });
    vi.mocked(updateEnrollmentRole).mockResolvedValue({
      status: "200", enrollment: { id: "e1", role: "INSTRUCTOR" }, previousRole: "TA",
    } as never);
    const res = await action(makeArgs("PATCH", { role: "INSTRUCTOR" }));
    expect(res.status).toBe(200);
  });

  it("surfaces 409 INSTRUCTOR_FLOOR_VIOLATION with the count (ADMIN included)", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(getEnrollment).mockResolvedValue({
      id: "e1", courseId: "c1", userId: "target", role: "INSTRUCTOR", isActive: true,
    } as never);
    vi.mocked(updateEnrollmentRole).mockResolvedValue({
      status: "409", error: "INSTRUCTOR_FLOOR_VIOLATION", currentInstructorCount: 1,
    } as never);
    const res = await action(makeArgs("PATCH", { role: "STUDENT" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INSTRUCTOR_FLOOR_VIOLATION",
      currentInstructorCount: 1,
    });
  });
});

describe("DELETE /api/courses/:id/enrollments/:enrollmentId (#305)", () => {
  it("returns 204 when an INSTRUCTOR removes a STUDENT", async () => {
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(204);
    expect(deactivateEnrollment).toHaveBeenCalledWith("c1", "e1");
  });

  it("returns 403 for a TA", async () => {
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(403);
    expect(deactivateEnrollment).not.toHaveBeenCalled();
  });

  it("blocks an INSTRUCTOR from removing a fellow INSTRUCTOR (§6)", async () => {
    vi.mocked(getEnrollment).mockResolvedValue({
      id: "e1", courseId: "c1", userId: "peer", role: "INSTRUCTOR", isActive: true,
    } as never);
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(403);
    expect(deactivateEnrollment).not.toHaveBeenCalled();
  });

  it("lets ADMIN remove an INSTRUCTOR when the floor holds", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(getEnrollment).mockResolvedValue({
      id: "e1", courseId: "c1", userId: "peer", role: "INSTRUCTOR", isActive: true,
    } as never);
    vi.mocked(deactivateEnrollment).mockResolvedValue({ status: "204", role: "INSTRUCTOR" } as never);
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(204);
  });

  it("surfaces 409 INSTRUCTOR_FLOOR_VIOLATION when removing the last instructor", async () => {
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(getEnrollment).mockResolvedValue({
      id: "e1", courseId: "c1", userId: "peer", role: "INSTRUCTOR", isActive: true,
    } as never);
    vi.mocked(deactivateEnrollment).mockResolvedValue({
      status: "409", error: "INSTRUCTOR_FLOOR_VIOLATION", currentInstructorCount: 1,
    } as never);
    const res = await action(makeArgs("DELETE"));
    expect(res.status).toBe(409);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await action({
      request: new Request("http://localhost/api/courses/c1/enrollments/e1", { method: "PUT" }),
      params: { id: "c1", enrollmentId: "e1" },
      context: {} as never,
    } as any);
    expect(res.status).toBe(405);
  });
});
