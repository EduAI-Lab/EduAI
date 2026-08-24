import { afterEach, describe, expect, it, vi } from "vitest";

const resolveCoreCourseById = vi.fn();
const authorizeLiveStudentEnrollment = vi.fn();

vi.mock("../../src/services/courseResolver.js", () => ({
  resolveCoreCourseById: (...args) => resolveCoreCourseById(...args),
}));

vi.mock("../../src/services/enrollmentSync.js", () => ({
  LIVE_ENROLLMENT_SYNC_TIMEOUT_MS: 3_000,
  authorizeLiveStudentEnrollment: (...args) => authorizeLiveStudentEnrollment(...args),
}));

const { authorizeLiveCoursePrincipal } = await import("../../src/services/liveCoursePrincipal.js");
const { enforceLiveCoursePrincipal } = await import("../../src/middleware/liveCoursePrincipal.js");

const course = { id: 1, coreOfferingId: "core-1", instructors: [] };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("authorizeLiveCoursePrincipal", () => {
  it("bounds a never-resolving UNIT_ADMIN Core lookup as unavailable", async () => {
    vi.useFakeTimers();
    resolveCoreCourseById.mockImplementation(() => new Promise(() => {}));
    const pending = authorizeLiveCoursePrincipal(course, {
      id: "unit-admin-1",
      role: "UNIT_ADMIN",
      authorizedUnits: ["COSC"],
    });
    const deadline = new Promise((resolve) => setTimeout(() => resolve("deadline"), 3_001));

    await vi.advanceTimersByTimeAsync(3_001);

    const result = await Promise.race([pending, deadline]);
    expect(result).toEqual({ state: "unavailable", kind: null, role: null });
    expect(resolveCoreCourseById).toHaveBeenCalledWith(
      "core-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns the exact live instructor principal without a preloaded mirror", async () => {
    authorizeLiveStudentEnrollment.mockResolvedValue({
      allowed: true,
      state: "allowed",
      role: "INSTRUCTOR",
    });

    const result = await authorizeLiveCoursePrincipal(course, {
      id: "instructor-1",
      role: "INSTRUCTOR",
    });

    expect(result).toEqual({ state: "allowed", kind: "INSTRUCTOR", role: "INSTRUCTOR" });
  });

  it("maps a never-resolving UNIT_ADMIN gate to 503 without calling next", async () => {
    vi.useFakeTimers();
    resolveCoreCourseById.mockImplementation(() => new Promise(() => {}));
    const req = {
      user: { id: "unit-admin-1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      path: "/api/courses/1/modules",
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    const pending = enforceLiveCoursePrincipal(req, res, next, course);
    await vi.advanceTimersByTimeAsync(3_001);
    await pending;

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "COURSE_AUTH_UNAVAILABLE" }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
