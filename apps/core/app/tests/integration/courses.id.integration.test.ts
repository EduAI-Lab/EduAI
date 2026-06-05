// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader } from "~/routes/api/courses.id";
import { auth } from "~/lib/auth/server";
import { seedUser, seedCourse, enroll, mockSession, cleanupRbac } from "../helpers/rbac";

const VALID_SERVICE_KEY = "courses-id-integration-service-key";
const ADMIN_SESSION = {
  user: { id: "", role: "ADMIN", email: "admin-courses-id@test.com", name: "Admin" },
};

let courseId: string;
let deletedCourseId: string;
let adminId: string;

beforeAll(async () => {
  vi.stubEnv("EDUAI_API_KEY", VALID_SERVICE_KEY);

  const admin = await prisma.user.create({
    data: {
      email: "admin-courses-id@test.com",
      name: "Admin Courses Id",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;

  const course = await prisma.course.create({
    data: {
      name: "GET By Id Course",
      code: "GID 101",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;

  const deleted = await prisma.course.create({
    data: {
      name: "Deleted Course",
      code: "GID 999",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
      deletedAt: new Date(),
    },
  });
  deletedCourseId = deleted.id;
});

afterAll(async () => {
  await prisma.course.deleteMany({
    where: { id: { in: [courseId, deletedCourseId] } },
  });
  await prisma.user.deleteMany({ where: { id: adminId } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

function makeArgs(id: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${id}`, { headers }),
    params: { id },
    context: {} as never,
  };
}

describe("GET /api/courses/:id", () => {
  it("returns 401 when no session is present", async () => {
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 200 with flat course object for active course (session)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(courseId);
    expect(body.name).toBe("GET By Id Course");
    expect(body.deletedAt).toBeNull();
  });

  it("returns 200 with flat course object via service key", async () => {
    const res = await loader(makeArgs(courseId, `Bearer ${VALID_SERVICE_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(courseId);
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND for unknown id", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeArgs("nonexistent-course-id"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 404 COURSE_NOT_FOUND for soft-deleted course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeArgs(deletedCourseId));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 403 for an authenticated user with no course relationship (#298)", async () => {
    const outsider = await seedUser({ role: "STUDENT" });
    try {
      mockSession(outsider);
      const res = await loader(makeArgs(courseId));
      expect(res.status).toBe(403);
    } finally {
      await cleanupRbac({ userIds: [outsider.id] });
    }
  });

  it("gates enrolled students on isPublished (§19) but admits them when published", async () => {
    const student = await seedUser({ role: "STUDENT" });
    const unpublished = await seedCourse({ isPublished: false });
    const published = await seedCourse({ isPublished: true });
    await enroll(unpublished.id, student.id, "STUDENT");
    await enroll(published.id, student.id, "STUDENT");

    try {
      mockSession(student);
      const blocked = await loader(makeArgs(unpublished.id));
      expect(blocked.status).toBe(403);

      mockSession(student);
      const allowed = await loader(makeArgs(published.id));
      expect(allowed.status).toBe(200);
    } finally {
      await cleanupRbac({ userIds: [student.id], courseIds: [unpublished.id, published.id] });
    }
  });
});
