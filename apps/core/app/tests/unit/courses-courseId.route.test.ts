// @vitest-environment node
// #1213 — courses.$courseId.tsx loader: found/not-found/unauthorized cases
// explicitly called out in the issue's done-when criteria.
import type { JsonObject } from "~/lib/json-value";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    // #1840: the staff branch loads every active INSTRUCTOR enrollment rather
    // than a platform-wide INSTRUCTOR user list.
    enrollment: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/rbac/resolve-course-access.server", () => ({
  resolveCourseAccess: vi.fn(),
}));

import { loader } from "~/routes/courses.$courseId";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { resolveCourseAccess } from "~/lib/rbac/resolve-course-access.server";

const BASE_COURSE = {
  id: "course-1",
  code: "COSC101",
  name: "Intro to CS",
  description: null,
  term: "Fall",
  year: 2026,
  isActive: true,
  isPublished: true,
  responseStyleTags: [],
  aiInstructions: null,
  courseScopeGuardrailEnabled: false,
  ragTopK: 5,
  ragSimilarityThreshold: 0.5,
  instructorId: "instructor-1",
  department: "COSC",
  startDate: new Date("2026-01-01"),
  endDate: null,
  externalSource: null,
  externalId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  instructor: { id: "instructor-1", name: "Prof", email: "prof@ubc.ca" },
};

function makeArgs(courseId?: string) {
  return {
    request: new Request("http://localhost/courses/course-1"),
    params: courseId === undefined ? { courseId: "course-1" } : { courseId },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
});

describe("courses.$courseId loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("redirects to /courses when the :courseId param is missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = (await loader(makeArgs(""))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses");
  });

  it("redirects to /courses when the course does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(null);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses");
  });

  it("redirects to /courses?access=denied when the user has no access", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(BASE_COURSE as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue(null);
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses?access=denied");
  });

  it("redirects a student to /courses?access=unpublished for an unpublished course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue({
      ...BASE_COURSE,
      isPublished: false,
    } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue("student");
    const res = (await loader(makeArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/courses?access=unpublished");
  });

  it("returns course data with hasAiConfig (not aiInstructions) for a student", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue({
      ...BASE_COURSE,
      aiInstructions: "be nice",
    } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue("student");

    const result = (await loader(makeArgs())) as {
      course: JsonObject;
      access: string;
      courseInstructors: unknown[];
    };
    expect(result.access).toBe("student");
    expect(result.course).not.toHaveProperty("aiInstructions");
    expect(result.course).toHaveProperty("hasAiConfig");
    expect(result.course).not.toHaveProperty("courseScopeGuardrailEnabled");
    expect(result.courseInstructors).toEqual([]);
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it("returns aiInstructions (not hasAiConfig) and every course instructor for an admin", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(BASE_COURSE as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue("admin");
    // #1840: two active instructors, only one of whom is Course.instructorId.
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      {
        id: "enr-1",
        userId: "instructor-1",
        user: { name: "Prof", email: "prof@ubc.ca", role: "INSTRUCTOR" },
      },
      {
        id: "enr-2",
        userId: "admin-2",
        user: { name: "Dr Admin", email: "admin@ubc.ca", role: "ADMIN" },
      },
    ] as never);

    const result = (await loader(makeArgs())) as {
      course: JsonObject;
      courseInstructors: { id: string; isPrimary: boolean; platformRole: string }[];
    };
    expect(result.course).toHaveProperty("aiInstructions", null);
    expect(result.course).not.toHaveProperty("hasAiConfig");
    expect(result.course).toHaveProperty("courseScopeGuardrailEnabled", false);
    expect(result.courseInstructors).toHaveLength(2);
    // Only the row matching Course.instructorId is the primary.
    expect(result.courseInstructors.map((row) => row.isPrimary)).toEqual([true, false]);
    // An ADMIN account holding an instructor enrollment is surfaced as such.
    expect(result.courseInstructors[1].platformRole).toBe("ADMIN");
  });

  it("looks up authorizedUnits from the DB for a UNIT_ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "ua-1", role: "UNIT_ADMIN" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(BASE_COURSE as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      authorizedUnits: ["COSC"],
    } as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue("unit");

    await loader(makeArgs());
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ua-1" } }),
    );
    expect(resolveCourseAccess).toHaveBeenCalledWith(
      expect.objectContaining({ authorizedUnits: ["COSC"] }),
      expect.anything(),
    );
  });
});
