// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  enrollment: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

import { loader } from "~/routes/api/courses.student-candidates.$";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";

const COURSE = { id: "c1" };

function session(role = "INSTRUCTOR", id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

function mockAccess(access: { level: string; rank: number } | null, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function args(query = "") {
  return {
    request: new Request(`http://localhost/api/courses/c1/student-candidates${query}`),
    params: { courseId: "c1" },
    context: {} as never,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.enrollment.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  mockAccess({ level: "instructor", rank: 2 });
});

describe("GET /api/courses/:courseId/student-candidates", () => {
  it("401s without a session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader(args());
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent course", async () => {
    session();
    mockAccess(null, null);
    const res = await loader(args());
    expect(res.status).toBe(404);
  });

  it("403s below rank 2 (e.g. a TA)", async () => {
    session();
    mockAccess({ level: "ta", rank: 1 });
    const res = await loader(args());
    expect(res.status).toBe(403);
  });

  it("200s for rank 2 (instructor) and returns candidates", async () => {
    session();
    prismaMock.user.findMany.mockResolvedValue([
      { id: "s1", name: "Alice", email: "alice@test.com" },
    ]);
    const res = await loader(args());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toEqual([{ id: "s1", name: "Alice", email: "alice@test.com" }]);
  });

  it("excludes any active enrollment by default (not just STUDENT-role)", async () => {
    session();
    await loader(args());
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith({
      where: { courseId: "c1", isActive: true },
      select: { userId: true },
    });
  });

  it("excludes only active TA enrollments when exclude=ta", async () => {
    session();
    await loader(args("?exclude=ta"));
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith({
      where: { courseId: "c1", role: "TA", isActive: true },
      select: { userId: true },
    });
  });

  it("passes the notIn filter built from excluded enrollment userIds", async () => {
    session();
    prismaMock.enrollment.findMany.mockResolvedValue([{ userId: "already-enrolled" }]);
    await loader(args());
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "STUDENT",
          isActive: true,
          id: { notIn: ["already-enrolled"] },
        }),
      }),
    );
  });

  it("adds a case-insensitive name/email search filter when ?q= is given", async () => {
    session();
    await loader(args("?q=ali"));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "ali", mode: "insensitive" } },
            { email: { contains: "ali", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("clamps an oversized ?limit= to the route's MAX_LIMIT (25)", async () => {
    session();
    await loader(args("?limit=9999"));
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
  });

  it("defaults to limit=20 when ?limit= is absent", async () => {
    session();
    await loader(args());
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});
