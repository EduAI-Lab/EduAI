// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  courseTopic: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  enrollment: { findFirst: vi.fn(), findUnique: vi.fn(), createMany: vi.fn() },
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
  deleteCourse,
  createCourseTopic,
  updateCourseTopic,
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

describe("updateCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when topic is missing or soft-deleted", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    const result = await updateCourseTopic("c1", "missing", { name: "Renamed" });
    expect(result).toEqual({ status: "404" });
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
  });

  it("renames the topic and returns 200", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue({ id: "t1" });
    prismaMock.courseTopic.update.mockResolvedValue({ id: "t1", name: "Renamed" });
    const result = await updateCourseTopic("c1", "t1", { name: "  Renamed  " });
    expect(result.status).toBe("200");
    expect(prismaMock.courseTopic.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { name: "Renamed" },
    });
  });

  it("returns 409 with existingId on duplicate name", async () => {
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce({ id: "t1" })
      .mockResolvedValueOnce({ id: "t2" });
    prismaMock.courseTopic.update.mockRejectedValue({ code: "P2002" });
    const result = await updateCourseTopic("c1", "t1", { name: "Taken" });
    expect(result).toEqual({ status: "409", existingId: "t2" });
  });

  it("returns 400 on empty name", async () => {
    const result = await updateCourseTopic("c1", "t1", { name: "" });
    expect(result.status).toBe("400");
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

  it("returns 200 with courses when ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1", name: "Algorithms" }]);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ courses: [{ id: "c1", name: "Algorithms" }] });
  });

  it("queries only non-deleted courses for ADMIN (unscoped)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findMany.mockResolvedValue([]);
    await getCourses(makeGetRequest());
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it("scopes non-admin callers to their enrollments with per-role publish gating (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findMany.mockResolvedValue([]);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          {
            enrollments: {
              some: { userId: "u1", isActive: true, role: { in: ["INSTRUCTOR", "TA"] } },
            },
          },
          {
            isPublished: true,
            enrollments: { some: { userId: "u1", isActive: true, role: "STUDENT" } },
          },
        ],
      },
    });
  });

  it("scopes UNIT_ADMIN to authorized units plus own enrollments (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    prismaMock.course.findMany.mockResolvedValue([]);
    await getCourses(makeGetRequest());
    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.OR[0]).toEqual({ department: { in: ["COSC"] } });
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

  it("returns 403 when caller is not ADMIN or UNIT_ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 403 when UNIT_ADMIN creates outside their authorized units (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["MATH"] });
    const res = await createCourse(
      makePostRequest({ ...VALID_COURSE_FIELDS, department: "COSC" }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "DEPARTMENT_NOT_AUTHORIZED" });
    expect(prismaMock.course.create).not.toHaveBeenCalled();
  });

  it("returns 403 when UNIT_ADMIN creates with no department (§19 null is never a match)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["MATH"] });
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 201 when UNIT_ADMIN creates inside their authorized units (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }]);
    prismaMock.course.create.mockResolvedValue({ id: "course-1" });
    prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });
    const res = await createCourse(
      makePostRequest({ ...VALID_COURSE_FIELDS, department: "COSC" }),
    );
    expect(res.status).toBe(201);
  });

  it("returns 400 for an unknown department code (§19 DepartmentSchema)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await createCourse(
      makePostRequest({ ...VALID_COURSE_FIELDS, department: "BASKET" }),
    );
    expect(res.status).toBe(400);
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
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "c1");
    expect(res.status).toBe(403);
  });

  it("returns 403 for an enrolled TA (rank < 2)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "c1");
    expect(res.status).toBe(403);
  });

  it("returns 200 when ADMIN updates the course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.course.update.mockResolvedValue({ id: "c1", name: "Updated" });
    const res = await updateCourse(makePatchRequest({ name: "Updated" }), "c1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("name", "Updated");
  });

  it("returns 200 when INSTRUCTOR of the course updates it", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    prismaMock.course.update.mockResolvedValue({ id: "c1", name: "Updated" });
    const res = await updateCourse(makePatchRequest({ name: "Updated" }), "c1");
    expect(res.status).toBe(200);
  });

  it("returns 403 when UNIT_ADMIN moves the course outside their units (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: "COSC" });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const res = await updateCourse(makePatchRequest({ department: "MATH" }), "c1");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "DEPARTMENT_NOT_AUTHORIZED" });
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("returns 200 when UNIT_ADMIN moves the course between their own units", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: "COSC" });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC", "MATH"] });
    prismaMock.course.update.mockResolvedValue({ id: "c1", department: "MATH" });
    const res = await updateCourse(makePatchRequest({ department: "MATH" }), "c1");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// deleteCourse
// ---------------------------------------------------------------------------

function makeDeleteRequest() {
  return new Request("http://localhost/api/courses/c1", { method: "DELETE" });
}

describe("deleteCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when course does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await deleteCourse(makeDeleteRequest(), "missing");
    expect(res.status).toBe(404);
  });

  it("returns 403 for an enrolled student", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("soft-deletes (sets deletedAt) for an enrolled INSTRUCTOR and returns 204", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    prismaMock.course.update.mockResolvedValue({ id: "c1" });
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(204);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
