// @vitest-environment node
//
// #297 — PATCH /api/users/:id guards: self-role-change lockout and
// authorizedUnits assignment rules (§4).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(),
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    course: { findMany: vi.fn() },
    enrollment: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// §541: authorizedUnits codes are validated against the Discipline table.
vi.mock("~/lib/disciplines/server", () => {
  const KNOWN = ["COSC", "MATH", "STAT", "DATA", "PHYS"];
  return {
    areValidDisciplineCodes: vi.fn(async (codes: string[]) => codes.every((c) => KNOWN.includes(c))),
    isValidDisciplineCode: vi.fn(async (code: string) => KNOWN.includes(code)),
  };
});

import { action, loader } from "~/routes/api/users.$";
import { auth } from "~/lib/auth/server";
import { logAuditAction } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";

const ADMIN = { id: "admin-1", role: "ADMIN" };

function makePatch(userId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { "*": userId },
    context: {} as never,
  } as any;
}

function makePost(body: unknown) {
  return {
    request: new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { "*": undefined },
    context: {} as never,
  } as any;
}

function makeGet() {
  return {
    // #1041: `page`/`pageSize` are required on GET /api/users.
    request: new Request("http://localhost/api/users?page=1&pageSize=25", { method: "GET" }),
    params: { "*": undefined },
    context: {} as never,
  } as any;
}

function mockUser(user: { id: string; role: string } | null) {
  vi.mocked(auth.api.getSession).mockResolvedValue((user ? { user } : null) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser(ADMIN);
  vi.mocked(prisma.user.update).mockResolvedValue({
    id: "target",
    enrollments: [],
    _count: { enrollments: 0, taughtCourses: 0, aiInteractions: 0 },
  } as never);
  vi.mocked(prisma.user.create).mockResolvedValue({
    id: "created-user",
    name: "Created User",
    email: "created@example.com",
    role: "STUDENT",
    _count: { enrollments: 0, taughtCourses: 0, aiInteractions: 0 },
  } as never);
  vi.mocked(prisma.enrollment.count).mockResolvedValue(0);
  vi.mocked(prisma.enrollment.findMany).mockResolvedValue([]);
  vi.mocked(prisma.enrollment.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.course.findMany).mockResolvedValue([]);
  // GET /api/users batches its count+findMany as an array transaction (#1041);
  // the mutation paths still pass an interactive callback.
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  vi.mocked(prisma.user.count).mockResolvedValue(1 as never);
});

describe("GET /api/users — TA course assignments (#967)", () => {
  it("keeps active STUDENT and TA course counts role-exclusive", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "student-1",
        email: "student@example.com",
        name: "Student User",
        role: "STUDENT",
        authorizedUnits: [],
        _count: { enrollments: 0, taughtCourses: 0, aiInteractions: 2 },
      },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      { userId: "student-1", courseId: "course-1" },
    ] as never);

    const res = await loader(makeGet());
    const body = await res.json();
    const users = body.data;

    expect(res.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: {
            select: expect.objectContaining({
              enrollments: {
                where: { role: "STUDENT", isActive: true },
              },
            }),
          },
        }),
      }),
    );
    expect(users[0]).toEqual(
      expect.objectContaining({
        taCourseIds: ["course-1"],
        _count: expect.objectContaining({
          enrolledCourses: 0,
          assistedCourses: 1,
        }),
      }),
    );
  });
});

describe("POST /api/users — authorizedUnits assignment (#967)", () => {
  it("persists validated units for a UNIT_ADMIN", async () => {
    const res = await action(
      makePost({
        name: "Unit Admin",
        email: "unit-admin@example.com",
        role: "UNIT_ADMIN",
        authorizedUnits: ["COSC", "MATH"],
      }),
    );

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "UNIT_ADMIN",
          authorizedUnits: ["COSC", "MATH"],
        }),
      }),
    );
  });

  it("rejects a non-unit role with a non-empty unit assignment", async () => {
    const res = await action(
      makePost({
        name: "Student User",
        email: "student@example.com",
        role: "STUDENT",
        authorizedUnits: ["COSC"],
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ROLE_MISMATCH" });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("preserves the duplicate-email guard", async () => {
    vi.mocked(prisma.user.create).mockRejectedValueOnce({ code: "P2002" });

    const res = await action(
      makePost({
        name: "Duplicate User",
        email: "duplicate@example.com",
        role: "STUDENT",
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "EMAIL_ALREADY_EXISTS" });
  });
});

describe("PATCH /api/users/:id — self guards (#297)", () => {
  it("rejects a non-admin caller with 403", async () => {
    mockUser({ id: "u1", role: "INSTRUCTOR" });
    const res = await action(makePatch("u2", { role: "TA" }));
    expect(res.status).toBe(403);
  });

  it("rejects self-role-change with 403", async () => {
    const res = await action(makePatch("admin-1", { role: "STUDENT" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "CANNOT_CHANGE_OWN_ROLE" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows a self-PATCH that does not change the role", async () => {
    const res = await action(makePatch("admin-1", { name: "Renamed Admin" }));
    expect(res.status).toBe(200);
  });

  it("still rejects self-deactivation with 400 (existing guard)", async () => {
    const res = await action(makePatch("admin-1", { isActive: false }));
    expect(res.status).toBe(400);
  });

  it("allows an admin role-change on ANOTHER user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    const res = await action(makePatch("other-user", { role: "INSTRUCTOR" }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "other-user" },
        data: { role: "INSTRUCTOR", authorizedUnits: [] },
      }),
    );
  });
});

describe("PATCH /api/users/:id — authorizedUnits assignment (#297)", () => {
  it.each(["STUDENT", "INSTRUCTOR", "ADMIN"] as const)(
    "allows an ordinary %s edit with an empty authorizedUnits array (#967)",
    async (role) => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ role } as never);

      const res = await action(
        makePatch(`${role.toLowerCase()}-1`, {
          name: `Updated ${role}`,
          authorizedUnits: [],
        }),
      );

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: `Updated ${role}`,
            authorizedUnits: [],
          },
        }),
      );
    },
  );

  it("accepts valid units on a UNIT_ADMIN target", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "UNIT_ADMIN" } as never);
    const res = await action(makePatch("ua-1", { authorizedUnits: ["COSC", "MATH"] }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { authorizedUnits: ["COSC", "MATH"] },
      }),
    );
  });

  it("rejects an invalid subject code with 400 (§541 Discipline check)", async () => {
    const res = await action(makePatch("ua-1", { authorizedUnits: ["cosc"] }));
    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a non-UNIT_ADMIN target with 422 ROLE_MISMATCH", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "INSTRUCTOR" } as never);
    const res = await action(makePatch("instr-1", { authorizedUnits: ["COSC"] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ROLE_MISMATCH" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("accepts units when the same request promotes the target to UNIT_ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    const res = await action(
      makePatch("u-promote", { role: "UNIT_ADMIN", authorizedUnits: ["COSC"] }),
    );
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      }),
    );
  });

  it.each(["STUDENT", "INSTRUCTOR", "ADMIN"] as const)(
    "clears stale units when demoting a UNIT_ADMIN to %s (#967)",
    async (role) => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "UNIT_ADMIN" } as never);

      const res = await action(makePatch("ua-demote", { role }));

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role, authorizedUnits: [] },
        }),
      );
    },
  );

  it("updates the authorized units of an existing UNIT_ADMIN (#967)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "UNIT_ADMIN" } as never);

    const res = await action(makePatch("ua-1", { authorizedUnits: ["STAT", "DATA"] }));

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { authorizedUnits: ["STAT", "DATA"] },
      }),
    );
  });

  it("returns 404 when the target user does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await action(makePatch("ghost", { authorizedUnits: ["COSC"] }));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/users/:id — TA course reconciliation (#967)", () => {
  it("assigns selected courses to an effective STUDENT in the user update transaction", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([{ id: "course-1" }] as never);
    vi.mocked(prisma.enrollment.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await action(makePatch("student-1", { taCourseIds: ["course-1"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.enrollment.create).toHaveBeenCalledWith({
      data: { courseId: "course-1", userId: "student-1", role: "TA", isActive: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "student-1" },
        select: expect.objectContaining({
          _count: {
            select: expect.objectContaining({
              enrollments: {
                where: { role: "STUDENT", isActive: true },
              },
            }),
          },
        }),
      }),
    );
    expect(body._count).toEqual(
      expect.objectContaining({ enrolledCourses: 0, assistedCourses: 1 }),
    );
    expect(body.taCourseIds).toEqual(["course-1"]);
    expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(2);
  });

  it("rejects non-empty TA courses when the effective platform role is not STUDENT", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "INSTRUCTOR" } as never);

    const res = await action(makePatch("instructor-1", { taCourseIds: ["course-1"] }));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "TA_ROLE_MISMATCH" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("clears active TA assignments when changing away from STUDENT", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);

    const res = await action(makePatch("student-1", { role: "INSTRUCTOR" }));

    expect(res.status).toBe(200);
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
      where: { userId: "student-1", role: "TA", isActive: true },
      data: { isActive: false },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "INSTRUCTOR" }),
      }),
    );
  });

  it("rejects assigning a course with an existing INSTRUCTOR enrollment", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([{ id: "course-1" }] as never);
    vi.mocked(prisma.enrollment.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "enrollment-1", courseId: "course-1", role: "INSTRUCTOR", isActive: true },
      ] as never);

    const res = await action(makePatch("student-1", { taCourseIds: ["course-1"] }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TA_INSTRUCTOR_ENROLLMENT_CONFLICT" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("audit-logs TA course assignments and removals with affected course IDs", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    vi.mocked(prisma.course.findMany).mockResolvedValue([{ id: "course-new" }] as never);
    vi.mocked(prisma.enrollment.findMany)
      .mockResolvedValueOnce([{ courseId: "course-old" }] as never)
      .mockResolvedValueOnce([]);

    const res = await action(
      makePatch("student-1", { role: "STUDENT", taCourseIds: ["course-new"] }),
    );

    expect(res.status).toBe(200);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "USER_TA_COURSES_CHANGED",
        entityId: "target",
        details: expect.objectContaining({
          taCourseIdsAdded: ["course-new"],
          taCourseIdsRemoved: ["course-old"],
        }),
      }),
    );
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "student-1",
        role: "TA",
        isActive: true,
        courseId: { notIn: ["course-new"] },
      },
      data: { role: "STUDENT", isActive: true },
    });
    expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(2);
  });

  it("audit-logs the previous and new platform roles plus TA courses cleared by demotion", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "STUDENT" } as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValueOnce([
      { courseId: "course-1" },
    ] as never);

    const res = await action(makePatch("student-1", { role: "INSTRUCTOR" }));

    expect(res.status).toBe(200);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "USER_ROLE_CHANGED",
        details: expect.objectContaining({
          previousRole: "STUDENT",
          newRole: "INSTRUCTOR",
          taCourseIdsAdded: [],
          taCourseIdsRemoved: ["course-1"],
        }),
      }),
    );
    expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(1);
  });
});
