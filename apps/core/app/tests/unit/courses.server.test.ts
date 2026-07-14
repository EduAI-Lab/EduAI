// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  enrollment: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/courses/cascadeDelete.server", () => ({
  cascadeDeleteToExtensions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicy: vi.fn(),
  logPolicyDenial: vi.fn(),
  denyByPolicy: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}));

// §541: department validation is now DB-backed. Stub the discipline checks with
// a fixed known-code set so these tests stay independent of the Discipline table.
vi.mock("~/lib/disciplines/server", () => {
  const KNOWN = ["COSC", "MATH", "STAT", "DATA", "PHYS", "BIOL", "HIST", "ENGL", "PHIL", "PSYO"];
  return {
    isValidDisciplineCode: vi.fn(async (code: string) => KNOWN.includes(code)),
    areValidDisciplineCodes: vi.fn(async (codes: string[]) => codes.every((c) => KNOWN.includes(c))),
  };
});

import {
  getCourse,
  getCourses,
  getCourseTopics,
  getCourseTopic,
  createCourse,
  updateCourse,
  deleteCourse,
  setPublishState,
  createCourseTopic,
  updateCourseTopic,
  deleteCourseTopic,
} from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { getPolicy } from "~/lib/policy.server";
import { cascadeDeleteToExtensions } from "~/lib/courses/cascadeDelete.server";

describe("getCourse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active (non-deleted) courses", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", name: "Active" });
    await getCourse("c1");
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", deletedAt: null },
    });
  });

  // #315: ADMIN forensics opt-in surfaces a soft-deleted course by id.
  it("drops the deletedAt filter when includeDeleted is true", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", name: "Deleted" });
    await getCourse("c1", true);
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1" },
    });
  });
});

describe("getCourses — #315 ADMIN includeDeleted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drops the deletedAt filter for ADMIN with ?includeDeleted=true", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin1", role: "ADMIN" },
    } as never);
    prismaMock.course.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getCourses(new Request("http://localhost/api/courses?includeDeleted=true"));

    expect(prismaMock.course.findMany).toHaveBeenCalledWith({ where: {} });
  });

  it("keeps deletedAt: null for ADMIN without the flag", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "admin1", role: "ADMIN" },
    } as never);
    prismaMock.course.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getCourses(new Request("http://localhost/api/courses"));

    expect(prismaMock.course.findMany).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it("ignores the flag for a non-ADMIN caller", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "inst1", role: "INSTRUCTOR" },
    } as never);
    prismaMock.course.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getCourses(new Request("http://localhost/api/courses?includeDeleted=true"));

    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
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

  // #315: ADMIN forensics opt-in surfaces soft-deleted topics in a live course.
  it("drops the deletedAt filter when includeDeleted is true", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([]);
    await getCourseTopics("c1", true);
    expect(prismaMock.courseTopic.findMany).toHaveBeenCalledWith({
      where: { courseId: "c1" },
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

  it("soft-deletes active topics by setting deletedAt and returns the topic", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue({ id: "t1", name: "Graphs" });
    prismaMock.courseTopic.update.mockResolvedValue({ id: "t1" });
    const result = await deleteCourseTopic("c1", { topicId: "t1" });
    expect(result).toEqual({ status: "204", topic: { id: "t1", name: "Graphs" } });
    expect(prismaMock.courseTopic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: "c1", deletedAt: null, id: "t1" },
      }),
    );
    expect(prismaMock.courseTopic.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { deletedAt: expect.any(Date), deletedBy: null },
    });
  });

  it("returns 404 when no active row matches", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    const result = await deleteCourseTopic("c1", { name: "Missing" });
    expect(result).toEqual({ status: "404" });
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
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
    prismaMock.enrollment.findMany.mockResolvedValue([]);
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 200 with courses when ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findMany.mockResolvedValue([{ id: "c1", name: "Algorithms" }]);
    prismaMock.enrollment.findMany.mockResolvedValue([{ courseId: "c1", role: "INSTRUCTOR" }]);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      courses: [{ id: "c1", name: "Algorithms", callerEnrollmentRole: "INSTRUCTOR" }],
    });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        isActive: true,
        courseId: { in: ["c1"] },
      },
      select: { courseId: true, role: true },
    });
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
  term: "W1",
  year: "2025",
  startDate: "2025-09-01",
  department: "COSC",
  instructorUserIds: "user-1",
};

function makeJsonPostRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/courses", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("createCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default the instructor-create policy OFF; tests that exercise it opt in.
    vi.mocked(getPolicy).mockResolvedValue(false);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock));
  });

  it("returns 403 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 403 when caller is STUDENT/TA", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
  });

  it("returns 403 when caller is INSTRUCTOR and the create-course policy is disabled", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } } as any);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canCreateCourses");
  });

  it("returns 201 and auto-enrolls a self-creating INSTRUCTOR when the policy is enabled", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "instr-1", role: "INSTRUCTOR" } } as any);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.user.findMany.mockResolvedValue([{ id: "instr-1" }]);
    prismaMock.course.create.mockResolvedValue({ id: "course-1" });
    prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });

    // No instructorUserIds supplied — the creator is added automatically.
    const { instructorUserIds: _omit, ...fieldsWithoutInstructors } = VALID_COURSE_FIELDS;
    const res = await createCourse(makePostRequest(fieldsWithoutInstructors));

    expect(res.status).toBe(201);
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith({
      data: [{ courseId: "course-1", userId: "instr-1", role: "INSTRUCTOR", isActive: true }],
    });
  });

  it("discards client-supplied instructorUserIds for a self-creating INSTRUCTOR (cannot assign another instructor)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "instr-1", role: "INSTRUCTOR" } } as any);
    vi.mocked(getPolicy).mockResolvedValue(true);
    prismaMock.user.findMany.mockResolvedValue([{ id: "instr-1" }]);
    prismaMock.course.create.mockResolvedValue({ id: "course-1" });
    prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });

    // Attacker supplies a different instructor's id as the primary instructor.
    const res = await createCourse(
      makePostRequest({ ...VALID_COURSE_FIELDS, instructorUserIds: "victim-instr" }),
    );

    expect(res.status).toBe(201);
    // Validation only ever queried the creator — the supplied victim id was dropped.
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["instr-1"] }, role: "INSTRUCTOR" },
      select: { id: true },
    });
    // The course's primary instructor (instructorUserIds[0]) is the creator.
    expect(prismaMock.course.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ instructorId: "instr-1" }),
      }),
    );
    // The sole instructor enrollment is the creator — the victim is never enrolled.
    expect(prismaMock.enrollment.createMany).toHaveBeenCalledWith({
      data: [{ courseId: "course-1", userId: "instr-1", role: "INSTRUCTOR", isActive: true }],
    });
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

  it("returns 422 when no department is provided (required field since §19 overhaul)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["MATH"] });
    const { department: _omit, ...fieldsWithoutDept } = VALID_COURSE_FIELDS;
    const res = await createCourse(makePostRequest(fieldsWithoutDept));
    expect(res.status).toBe(422);
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

  it("returns 400 for an unknown department code (§541 Discipline check)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await createCourse(
      makePostRequest({ ...VALID_COURSE_FIELDS, department: "BASKET" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await createCourse(makePostRequest({ name: "Only Name" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "VALIDATION_ERROR");
  });

  it("returns 422 when instructorUserIds do not map to INSTRUCTOR users", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.user.findMany.mockResolvedValue([]);
    const res = await createCourse(makePostRequest(VALID_COURSE_FIELDS));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "INVALID_INSTRUCTOR");
  });

  it("returns 201 and creates course + enrollment on valid formData input", async () => {
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

  it("returns 201 and creates course from JSON body", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-1" }]);
    const created = { id: "course-json", name: "Algorithms" };
    prismaMock.course.create.mockResolvedValue(created);
    prismaMock.enrollment.createMany.mockResolvedValue({ count: 1 });

    const res = await createCourse(
      makeJsonPostRequest({
        name: "Algorithms",
        code: "COSC 320",
        section: "001",
        term: "W1",
        year: 2025,
        startDate: "2025-09-01",
        department: "COSC",
        instructorUserIds: ["user-1"],
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
  });

  it("returns 422 for invalid JSON body", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await createCourse(
      new Request("http://localhost/api/courses", {
        method: "POST",
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "VALIDATION_ERROR",
      fields: { body: "invalid JSON" },
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
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await updateCourse(makePatchRequest({ name: "New Name" }), "c1");
    expect(res.status).toBe(401);
  });

  it("returns 422 on invalid payload", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    const res = await updateCourse(makePatchRequest({ year: "not-a-number" }), "c1");
    expect(res.status).toBe(422);
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

  // tas.canSetAiInstructions (field-scoped grant) -------------------------------

  it("TA aiInstructions-only PATCH succeeds when tas.canSetAiInstructions is on (200)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "ta-1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    prismaMock.course.update.mockResolvedValue({ id: "c1", aiInstructions: "Be concise." });
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await updateCourse(makePatchRequest({ aiInstructions: "Be concise." }), "c1");
    expect(res.status).toBe(200);
    expect(getPolicy).toHaveBeenCalledWith("tas.canSetAiInstructions");
    // Only the aiInstructions field is written — the grant can't edit anything else.
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { aiInstructions: "Be concise." },
    });
  });

  it("TA PATCH of a non-aiInstructions field is still 403 even when the grant is on", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "ta-1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await updateCourse(
      makePatchRequest({ aiInstructions: "Be concise.", name: "Hijack" }),
      "c1",
    );
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("TA aiInstructions PATCH is 403 when tas.canSetAiInstructions is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "ta-1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await updateCourse(makePatchRequest({ aiInstructions: "Be concise." }), "c1");
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
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
    expect(cascadeDeleteToExtensions).not.toHaveBeenCalled();
  });

  it("soft-deletes (sets deletedAt) for an enrolled INSTRUCTOR and returns 204", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    prismaMock.course.update.mockResolvedValue({ id: "c1" });
    vi.mocked(getPolicy).mockResolvedValue(true); // instructors.canDeleteCourses on
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(204);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("pushes cascade-delete to QM and AI Tutor after a successful soft-delete (§802)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.course.update.mockResolvedValue({ id: "c1" });
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(204);
    expect(cascadeDeleteToExtensions).toHaveBeenCalledWith("c1");
    expect(cascadeDeleteToExtensions).toHaveBeenCalledTimes(1);
  });

  it("does not push cascade-delete when the course was not found", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue(null);
    await deleteCourse(makeDeleteRequest(), "missing");
    expect(cascadeDeleteToExtensions).not.toHaveBeenCalled();
  });

  it("returns 403 for an INSTRUCTOR when instructors.canDeleteCourses is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canDeleteCourses");
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("returns 403 for a UNIT_ADMIN when unitAdmins.canDeleteCourses is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: "COSC" });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("unitAdmins.canDeleteCourses");
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("soft-deletes for a UNIT_ADMIN when unitAdmins.canDeleteCourses is on (204)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "UNIT_ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: "COSC" });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    prismaMock.course.update.mockResolvedValue({ id: "c1" });
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(204);
  });

  it("ADMIN delete is unaffected by the delete policy flags (204 even when off)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.course.update.mockResolvedValue({ id: "c1" });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await deleteCourse(makeDeleteRequest(), "c1");
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// setPublishState (§5 — publish / unpublish)
// ---------------------------------------------------------------------------

const VALID_KEY = "test-service-key";

function makePublishRequest(bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  return new Request("http://localhost/api/courses/c1/publish", { method: "PATCH", headers });
}

describe("setPublishState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  // Service key path -----------------------------------------------------------

  it("service key — returns 404 when course does not exist", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await setPublishState(makePublishRequest(VALID_KEY), "c1", true);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("service key — publishes course and returns 200", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.course.update.mockResolvedValue({ id: "c1", isPublished: true });
    const res = await setPublishState(makePublishRequest(VALID_KEY), "c1", true);
    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isPublished: true },
    });
  });

  it("service key — unpublishes course and returns 200", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.course.update.mockResolvedValue({ id: "c1", isPublished: false });
    const res = await setPublishState(makePublishRequest(VALID_KEY), "c1", false);
    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isPublished: false },
    });
  });

  it("service key — returns 403 when requireServiceKey rejects the key", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await setPublishState(makePublishRequest("wrong-key"), "c1", true);
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  // User session path ----------------------------------------------------------

  it("session — returns 401 when no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(401);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("session — returns 404 when course does not exist or is soft-deleted", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue(null);
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("session — returns 403 for a TA (rank < 2)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("session — returns 403 for a user with no course relationship", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "STUDENT" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("session — INSTRUCTOR publishes their course when the flag is on (returns 200)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    prismaMock.course.update.mockResolvedValue({ id: "c1", isPublished: true });
    vi.mocked(getPolicy).mockResolvedValue(true); // instructors.canPublishCourses on
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isPublished: true },
    });
  });

  it("session — returns 403 for an INSTRUCTOR when instructors.canPublishCourses is off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u2", role: "INSTRUCTOR" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: true });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await setPublishState(makePublishRequest(), "c1", true);
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("instructors.canPublishCourses");
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it("session — ADMIN unpublishes any course (returns 200), unaffected by the publish flag", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1", role: "ADMIN" } } as any);
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", department: null });
    prismaMock.course.update.mockResolvedValue({ id: "c1", isPublished: false });
    vi.mocked(getPolicy).mockResolvedValue(false); // off — ADMIN still allowed
    const res = await setPublishState(makePublishRequest(), "c1", false);
    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isPublished: false },
    });
  });
});
