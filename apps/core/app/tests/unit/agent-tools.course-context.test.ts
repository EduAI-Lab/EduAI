// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/auth/course-access.server", () => ({
  buildCourseListFilter: vi.fn(),
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourseTopics: vi.fn(),
  getCourseTopic: vi.fn(),
}));

import { buildCourseListFilter, resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getCourseTopics, getCourseTopic } from "~/lib/courses/server";
import {
  getAccessibleCourse,
  getAccessibleCourseTopic,
  listAccessibleCourseTopics,
  listAccessibleCourses,
} from "~/lib/agent-tools/course-context.server";

const USER = { id: "u1", role: "STUDENT" };
const COURSE = { id: "c1", isPublished: true, department: "COSC" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAccessibleCourses", () => {
  it("returns RBAC-filtered courses", async () => {
    vi.mocked(buildCourseListFilter).mockResolvedValue({ deletedAt: null });
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1", code: "COSC 101", name: "Intro" }]);

    const result = await listAccessibleCourses(USER);
    expect(result.courses).toHaveLength(1);
    expect(buildCourseListFilter).toHaveBeenCalledWith(USER);
  });
});

describe("getAccessibleCourse", () => {
  it("returns 403-shaped error when access is denied", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: COURSE as never,
      access: null,
    });
    const result = await getAccessibleCourse(USER, "c1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns course detail when access is granted", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: COURSE as never,
      access: { level: "student", rank: 0 },
    });
    prismaMock.course.findFirst.mockResolvedValue({
      id: "c1",
      code: "COSC 101",
      name: "Intro",
    });

    const result = await getAccessibleCourse(USER, "c1");
    expect(result).toEqual({
      course: { id: "c1", code: "COSC 101", name: "Intro" },
    });
  });
});

describe("listAccessibleCourseTopics", () => {
  it("returns topics when user has course access", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: COURSE as never,
      access: { level: "student", rank: 0 },
    });
    vi.mocked(getCourseTopics).mockResolvedValue([
      { id: "t1", courseId: "c1", name: "Loops", createdAt: new Date(), updatedAt: new Date(), createdBy: null, deletedAt: null, deletedBy: null },
    ]);

    const result = await listAccessibleCourseTopics(USER, "c1");
    expect(result).toEqual({
      topics: [
        expect.objectContaining({ id: "t1", name: "Loops" }),
      ],
    });
  });
});

describe("getAccessibleCourseTopic", () => {
  it("returns TOPIC_NOT_FOUND when missing", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: COURSE as never,
      access: { level: "student", rank: 0 },
    });
    vi.mocked(getCourseTopic).mockResolvedValue(null);

    const result = await getAccessibleCourseTopic(USER, "c1", "missing");
    expect(result).toEqual({ error: "TOPIC_NOT_FOUND" });
  });
});
