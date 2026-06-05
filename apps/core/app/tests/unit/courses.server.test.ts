// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  courseTopic: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  user: { findMany: vi.fn() },
  enrollment: { findFirst: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(),
}));

import {
  getCourse,
  getCourses,
  getCourseTopics,
  getCourseTopic,
  createCourse,
  updateCourse,
  createCourseTopic,
  deleteCourseTopic,
} from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";

describe("getCourse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active (non-deleted) courses", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", name: "Active" });
    await getCourse("c1");
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", deletedAt: null },
    });
  });
});

describe("getCourseTopics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active topics for the course", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([]);
    await getCourseTopics("c1");
    expect(prismaMock.courseTopic.findMany).toHaveBeenCalledWith({
      where: { courseId: "c1", deletedAt: null },
      orderBy: { name: "asc" },
    });
  });
});

describe("getCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active topics matching course and id", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    await getCourseTopic("c1", "t1");
    expect(prismaMock.courseTopic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", courseId: "c1", deletedAt: null },
    });
  });
});

describe("createCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when course is missing or soft-deleted", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await createCourseTopic("missing-course", { name: "Heaps" });
    expect(result).toEqual({ status: "404" });
    expect(prismaMock.courseTopic.create).not.toHaveBeenCalled();
  });

  it("creates topic when course exists", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.courseTopic.create.mockResolvedValue({
      id: "t1",
      courseId: "c1",
      name: "Heaps",
      deletedAt: null,
    });
    const result = await createCourseTopic("c1", { name: "Heaps" });
    expect(result.status).toBe("201");
    expect(result).toHaveProperty("topic");
    expect(prismaMock.courseTopic.create).toHaveBeenCalled();
  });

  it("persists createdBy when a user id is provided (#294)", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.courseTopic.create.mockResolvedValue({ id: "t1" });
    await createCourseTopic("c1", { name: "Heaps" }, "user-9");
    expect(prismaMock.courseTopic.create).toHaveBeenCalledWith({
      data: { courseId: "c1", name: "Heaps", createdBy: "user-9" },
    });
  });

  it("defaults createdBy to null (service-key path — no owner)", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.courseTopic.create.mockResolvedValue({ id: "t1" });
    await createCourseTopic("c1", { name: "Heaps" });
    expect(prismaMock.courseTopic.create).toHaveBeenCalledWith({
      data: { courseId: "c1", name: "Heaps", createdBy: null },
    });
  });
});

describe("deleteCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes active topics by setting deletedAt", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 1 });
    const result = await deleteCourseTopic("c1", { topicId: "t1" });
    expect(result).toEqual({ status: "204" });
    expect(prismaMock.courseTopic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: "c1", deletedAt: null, id: "t1" },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it("returns 404 when no active row matches", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteCourseTopic("c1", { name: "Missing" });
    expect(result).toEqual({ status: "404" });
  });
});

// ---------------------------------------------------------------------------
// getCourses
// ---------------------------------------------------------------------------

function makeGetRequest(headers?: Record<string, string>) {
  return new Request("http://localhost/api/courses", { method: "GET", headers });
}

describe("getCourses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(403);
  });

  it("returns 200 with courses when ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1", name: "Algorithms" }]);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ courses: [{ id: "c1", name: "Algorithms" }] });
  });

  it("queries only non-deleted courses", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findMany.mockResolvedValue([]);
    await getCourses(makeGetRequest());
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it("uses apiKeySession when enforceAdminIfApiKey resolves one", async () => {
    const apiKeySession = { user: { id: "u2", role: "ADMIN" } };
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: apiKeySession as any });
    prismaMock.course.findMany.mockResolvedValue([]);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCourse
// ---------------------------------------------------------------------------

function makePostRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/api/courses", { method: "POST", body: formData });
}

const VALID_COURSE_FIELDS = {
  name: "Algorithms",
  code: "COSC 320",
  section: "001",
  term: "Fall",
  year: "2025",
  startDate: "2025-09-01",
  instructorUserIds: "user-1",
};

describe("createCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock));
  });

  it("returns 403 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 403 when caller is not ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await createCourse(makePostRequest({ name: "Only Name" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "Invalid input");
  });

  it("returns 422 when instructorUserIds do not map to INSTRUCTOR users", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.user.findMany.mockResolvedValue([]);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "INVALID_INSTRUCTOR");
  });

  it("returns 201 and creates course + enrollment on valid input", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }]);
    const created = { id: "course-1", name: "Algorithms" };
    prismaMock.course.create.mockResolvedValue(created);
    prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });

    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(created);
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith({
      data: [{ courseId: "course-1", userId: "user-1", role: "INSTRUCTOR", isActive: true }],
    });
  });
});

// ---------------------------------------------------------------------------
// updateCourse
// ---------------------------------------------------------------------------

function makePatchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/courses/c1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("updateCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "c1");
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid payload", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await updateCourse(makePatchRequest({ year: "not-a-number" }), "c1");
    expect(res.status).toBe(400);
  });

  it("returns 404 when course does not exist or is soft-deleted", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "missing");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error", "COURSE_NOT_FOUND");
  });

  it("returns 403 when non-admin caller is not an instructor of the course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "c1");
    expect(res.status).toBe(403);
  });

  it("returns 200 when ADMIN updates the course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.course.update.mockResolvedValue({ id: "c1", name: "Updated" });
    const res = await updateCourse(makePatchRequest({ name: "Updated" }), "c1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("name", "Updated");
  });

  it("returns 200 when INSTRUCTOR of the course updates it", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: "e1" });
    prismaMock.course.update.mockResolvedValue({ id: "c1", name: "Updated" });
    const res = await updateCourse(makePatchRequest({ name: "Updated" }), "c1");
    expect(res.status).toBe(200);
  });
});
