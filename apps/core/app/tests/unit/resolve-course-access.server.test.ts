// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveCourseAccessWithCourseMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: resolveCourseAccessWithCourseMock,
}));

import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";

const COURSE = {
  id: "c1",
  instructorId: null,
  department: "COSC",
  // Extra field that must NOT be forwarded — only `course.id` is passed.
  code: "COSC 111",
};
const USER = {
  id: "u1",
  role: "STUDENT" as const,
  authorizedUnits: [] as string[],
  // Extra runtime field that must be dropped by the wrapper's narrowing.
  name: "Student User",
};

beforeEach(() => {
  resolveCourseAccessWithCourseMock.mockReset();
});

describe("resolveCourseAccess", () => {
  it("returns null when the underlying resolver finds no relationship", async () => {
    resolveCourseAccessWithCourseMock.mockResolvedValue({ course: COURSE, access: null });
    const access = await resolveCourseAccess(USER, COURSE);
    expect(access).toBeNull();
  });

  it("unwraps the resolved level when access is present", async () => {
    resolveCourseAccessWithCourseMock.mockResolvedValue({
      course: COURSE,
      access: { level: "admin", rank: 4 },
    });
    const access = await resolveCourseAccess(USER, COURSE);
    expect(access).toBe("admin");
  });

  it("forwards user id/role/authorizedUnits and the course id to the canonical resolver", async () => {
    resolveCourseAccessWithCourseMock.mockResolvedValue({ course: COURSE, access: null });
    await resolveCourseAccess(USER, COURSE);
    expect(resolveCourseAccessWithCourseMock).toHaveBeenCalledWith(
      { id: "u1", role: "STUDENT", authorizedUnits: [] },
      "c1",
    );
    const [forwardedUser, forwardedCourseId] =
      resolveCourseAccessWithCourseMock.mock.calls[0]!;
    expect(forwardedUser).not.toHaveProperty("name");
    expect(forwardedCourseId).toBe("c1");
    expect(forwardedCourseId).not.toEqual(COURSE);
  });
});
