// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from "vitest";

const resolveCourseAccessWithCourse = vi.fn();

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: (...args: unknown[]) => resolveCourseAccessWithCourse(...args),
}));

import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";

const COURSE = { id: "c1", department: "COSC", embeddingProvider: "local" };

beforeEach(() => {
  vi.clearAllMocks();
});

// #225 AUTH-10: aligns with the canonical resolveCourseAccessWithCourse instead
// of re-deriving access from platform role alone.
describe("getCourseIfCanManageMaterials", () => {
  it("returns the course for ADMIN (platform-role bypass, unchanged behavior)", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "admin", rank: 4 },
    });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "ADMIN" }, "c1");
    expect(result).toEqual(COURSE);
  });

  it("returns the course for a UNIT_ADMIN acting in their unit (previously denied)", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "unit", rank: 3 },
    });
    const result = await getCourseIfCanManageMaterials(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(result).toEqual(COURSE);
  });

  it("returns the course for a platform-role INSTRUCTOR with an active INSTRUCTOR enrollment", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "instructor", rank: 2 },
    });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "INSTRUCTOR" }, "c1");
    expect(result).toEqual(COURSE);
  });

  it("returns the course for a grad-TA (platform role STUDENT) holding an INSTRUCTOR enrollment (previously denied)", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "instructor", rank: 2 },
    });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "STUDENT" }, "c1");
    expect(result).toEqual(COURSE);
  });

  it("returns null for a TA-level enrollment", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "ta", rank: 1 },
    });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "STUDENT" }, "c1");
    expect(result).toBeNull();
  });

  it("returns null for a STUDENT-level enrollment", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "student", rank: 0 },
    });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "STUDENT" }, "c1");
    expect(result).toBeNull();
  });

  it("returns null when there is no relationship to the course at all", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({ course: COURSE, access: null });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "STUDENT" }, "c1");
    expect(result).toBeNull();
  });

  it("returns null when the course does not exist", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({ course: null, access: null });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "ADMIN" }, "missing");
    expect(result).toBeNull();
  });

  // #225 AUTH-11: the resolver's course lookup filters `deletedAt: null`, so a
  // soft-deleted course can never be re-embedded through this helper — even
  // for ADMIN, which previously used an unfiltered `findUnique`.
  it("returns null for a soft-deleted course even for ADMIN", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({ course: null, access: null });
    const result = await getCourseIfCanManageMaterials({ id: "u1", role: "ADMIN" }, "deleted-course");
    expect(result).toBeNull();
  });

  it("forwards authorizedUnits through to the resolver", async () => {
    resolveCourseAccessWithCourse.mockResolvedValue({
      course: COURSE,
      access: { level: "unit", rank: 3 },
    });
    await getCourseIfCanManageMaterials(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC", "MATH"] },
      "c1",
    );
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC", "MATH"] },
      "c1",
    );
  });
});
