// @vitest-environment node
// #1213 — courses.$courseId.tsx loader: found/not-found/unauthorized cases
// explicitly called out in the issue's done-when criteria.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
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

  it("redirects a student to /courses for an unpublished course", async () => {
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
    expect(res.headers.get("Location")).toBe("/courses");
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
      course: Record<string, unknown>;
      access: string;
      instructors: unknown[];
    };
    expect(result.access).toBe("student");
    expect(result.course).not.toHaveProperty("aiInstructions");
    expect(result.course).toHaveProperty("hasAiConfig");
    expect(result.instructors).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("returns aiInstructions (not hasAiConfig) and the instructor list for an admin", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.course.findUnique).mockResolvedValue(BASE_COURSE as never);
    vi.mocked(resolveCourseAccess).mockResolvedValue("admin");
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "instructor-1", name: "Prof", email: "prof@ubc.ca" },
    ] as never);

    const result = (await loader(makeArgs())) as {
      course: Record<string, unknown>;
      instructors: unknown[];
    };
    expect(result.course).toHaveProperty("aiInstructions", null);
    expect(result.course).not.toHaveProperty("hasAiConfig");
    expect(result.instructors).toHaveLength(1);
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
