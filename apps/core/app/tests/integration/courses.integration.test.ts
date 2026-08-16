// @vitest-environment node
//
// Integration tests for /api/courses.
// Uses the test database configured in apps/core/.env.test

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCourses, createCourse } from "~/lib/courses/server";
import { auth } from "~/lib/auth/server";
import {
  seedUser,
  seedCourse,
  enroll,
  mockSession,
  cleanupRbac,
} from "../helpers/rbac";
import { setPolicy, invalidatePolicyCache } from "~/lib/policy.server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// #1041: `page`/`pageSize` are required on GET /api/courses, and the response is
// the `{ data, total, page, pageSize }` envelope.
const PAGED = "page=1&pageSize=200";

function makeGetRequest() {
  return new Request(`http://localhost/api/courses?${PAGED}`, { method: "GET" });
}

function makeFormDataPost(fields: Record<string, string | number>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, String(value));
  }
  return new Request("http://localhost/api/courses", {
    method: "POST",
    body: formData,
  });
}

const ADMIN_SESSION = {
  user: { id: "", role: "ADMIN", email: "admin-courses@test.com", name: "Admin" },
};
const INSTRUCTOR_SESSION = {
  user: { id: "", role: "INSTRUCTOR", email: "integration-courses-test@example.com", name: "Integration Professor" },
};

// ---------------------------------------------------------------------------
// Seed / teardown
// ---------------------------------------------------------------------------

let instructorId: string;
let adminId: string;
let courseId: string;
const createdCourseIds: string[] = [];

beforeAll(async () => {
  const instructor = await prisma.user.create({
    data: {
      email: "integration-courses-test@example.com",
      name: "Integration Instructor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  instructorId = instructor.id;
  INSTRUCTOR_SESSION.user.id = instructorId;

  const admin = await prisma.user.create({
    data: {
      email: "admin-courses@test.com",
      name: "Admin Courses",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;

  const course = await prisma.course.create({
    data: {
      name: "Integration Test Course",
      code: "INT 999",
      section: "001",
      term: "W1",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;

  await prisma.enrollment.create({
    data: { courseId, userId: instructorId, role: "INSTRUCTOR" },
  });
});

afterAll(async () => {
  if (createdCourseIds.length > 0) {
    await prisma.enrollment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  }
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: { in: [instructorId, adminId] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// GET /api/courses
// ---------------------------------------------------------------------------

describe("GET /api/courses", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(401);
  });

  // #315 §19: soft-deleted courses are invisible by default; an ADMIN may opt in
  // with ?includeDeleted=true. The flag is ignored for non-ADMIN callers.
  it("hides soft-deleted courses by default and surfaces them for ADMIN with ?includeDeleted=true", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    const deleted = await seedCourse({ isPublished: true });
    await prisma.course.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });

    try {
      mockSession(admin);

      // Default read: soft-deleted course is invisible even to ADMIN.
      const defaultRes = await getCourses(makeGetRequest());
      const defaultIds = (await defaultRes.json()).data.map((c: { id: string }) => c.id);
      expect(defaultIds).not.toContain(deleted.id);

      // ADMIN forensics opt-in: soft-deleted course appears.
      const inclRes = await getCourses(
        new Request(`http://localhost/api/courses?includeDeleted=true&${PAGED}`, { method: "GET" }),
      );
      const inclIds = (await inclRes.json()).data.map((c: { id: string }) => c.id);
      expect(inclIds).toContain(deleted.id);
    } finally {
      await cleanupRbac({ userIds: [admin.id], courseIds: [deleted.id] });
    }
  });

  it("ignores ?includeDeleted=true for a non-ADMIN caller", async () => {
    const instructor = await seedUser({ role: "INSTRUCTOR" });
    const deleted = await seedCourse({ isPublished: true });
    await enroll(deleted.id, instructor.id, "INSTRUCTOR");
    await prisma.course.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });

    try {
      mockSession(instructor);
      const res = await getCourses(
        new Request(`http://localhost/api/courses?includeDeleted=true&${PAGED}`, { method: "GET" }),
      );
      const ids = (await res.json()).data.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(deleted.id);
    } finally {
      await cleanupRbac({ userIds: [instructor.id], courseIds: [deleted.id] });
    }
  });

  it("returns 200 scoped to enrollments for an INSTRUCTOR (#298)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
    const res = await getCourses(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((c: { id: string }) => c.id);
    // Enrolled as INSTRUCTOR in the seeded (unpublished) course — visible.
    expect(ids).toContain(courseId);
    // Sees ONLY enrolled courses, not the whole catalog.
    expect(
      body.data.every((c: { id: string }) => ids.includes(c.id) && c.id !== "nonexistent"),
    ).toBe(true);
  });

  it("applies the publish gate per enrollment role — grad-TA mixed case (§1)", async () => {
    // UserRole=STUDENT user: TA in unpublished course A, STUDENT in unpublished course B.
    const gradTa = await seedUser({ role: "STUDENT" });
    const courseA = await seedCourse({ isPublished: false });
    const courseB = await seedCourse({ isPublished: false });
    await enroll(courseA.id, gradTa.id, "TA");
    await enroll(courseB.id, gradTa.id, "STUDENT");

    try {
      mockSession(gradTa);
      const res = await getCourses(makeGetRequest());
      expect(res.status).toBe(200);
      const ids = (await res.json()).data.map((c: { id: string }) => c.id);
      expect(ids).toContain(courseA.id); // TA: publish gate exempt
      expect(ids).not.toContain(courseB.id); // STUDENT: unpublished hidden
    } finally {
      await cleanupRbac({ userIds: [gradTa.id], courseIds: [courseA.id, courseB.id] });
    }
  });

  it("scopes UNIT_ADMIN to their authorized units (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    const coscCourse = await seedCourse({ department: "COSC", isPublished: false });
    const mathCourse = await seedCourse({ department: "MATH", isPublished: true });
    const noDeptCourse = await seedCourse({ department: null, isPublished: true });

    try {
      mockSession(unitAdmin);
      const res = await getCourses(makeGetRequest());
      expect(res.status).toBe(200);
      const ids = (await res.json()).data.map((c: { id: string }) => c.id);
      expect(ids).toContain(coscCourse.id);
      expect(ids).not.toContain(mathCourse.id);
      expect(ids).not.toContain(noDeptCourse.id); // §19: null department never matches
    } finally {
      await cleanupRbac({
        userIds: [unitAdmin.id],
        courseIds: [coscCourse.id, mathCourse.id, noDeptCourse.id],
      });
    }
  });

  it("returns 200 with a page envelope for ADMIN", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await getCourses(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(typeof body.page).toBe("number");
    expect(typeof body.pageSize).toBe("number");
  });

  it("includes the seeded course in the response", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await getCourses(makeGetRequest());

    const body = await res.json();
    const found = body.data.find((c: { id: string }) => c.id === courseId);
    expect(found).toBeDefined();
    expect(found.name).toBe("Integration Test Course");
    expect(found.code).toBe("INT 999");
  });

  it("excludes soft-deleted courses", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const deleted = await prisma.course.create({
      data: {
        name: "Deleted Course",
        code: "DEL 999",
        section: "001",
        term: "W1",
        year: 2025,
        startDate: new Date("2025-09-01"),
        deletedAt: new Date(),
      },
    });

    const res = await getCourses(makeGetRequest());
    const body = await res.json();
    const found = body.data.find((c: { id: string }) => c.id === deleted.id);
    expect(found).toBeUndefined();

    await prisma.course.delete({ where: { id: deleted.id } });
  });
});

// ---------------------------------------------------------------------------
// GET /api/courses — search & filters before pagination (#1263)
// ---------------------------------------------------------------------------

describe("GET /api/courses — search & filters before pagination (#1263)", () => {
  type ListRow = {
    name: string;
    code: string;
    term: string;
    year: number;
    department: string | null;
    isPublished: boolean;
  };

  // Sorts code-asc: the `ZZZ*` rows land past page 1 at any pageSize < 7, which
  // is the premise every "beyond page 1" assertion relies on. All totals are
  // deterministic because each test scopes a fresh INSTRUCTOR to exactly these.
  const FIXTURE: ListRow[] = [
    { name: "Old Term Course", code: "AAA 050", term: "W1", year: 2025, department: "COSC", isPublished: true },
    { name: "Filler One", code: "AAA 100", term: "W1", year: 2026, department: "COSC", isPublished: true },
    { name: "Filler Two", code: "AAA 200", term: "W1", year: 2026, department: "COSC", isPublished: true },
    { name: "Term Target Course", code: "ZZZ 100", term: "W2", year: 2026, department: "COSC", isPublished: true },
    { name: "Status Draft Course", code: "ZZZ 200", term: "W1", year: 2026, department: "COSC", isPublished: false },
    { name: "Department Math Course", code: "ZZZ 300", term: "W1", year: 2026, department: "MATH", isPublished: true },
    { name: "Search Target Course", code: "ZZZ 400", term: "W1", year: 2026, department: "COSC", isPublished: true },
  ];

  async function seedScopedList(rows: ListRow[]) {
    const instructor = await seedUser({ role: "INSTRUCTOR" });
    const ids: Record<string, string> = {};
    for (const row of rows) {
      const created = await prisma.course.create({
        data: {
          name: row.name,
          code: row.code,
          section: "001",
          term: row.term,
          year: row.year,
          startDate: new Date("2026-01-01"),
          department: row.department,
          isPublished: row.isPublished,
        },
      });
      await enroll(created.id, instructor.id, "INSTRUCTOR");
      ids[row.name] = created.id;
    }
    return { instructor, ids, allIds: Object.values(ids) };
  }

  async function runWithFixture(
    fn: (ctx: Awaited<ReturnType<typeof seedScopedList>>) => Promise<void>,
  ) {
    const ctx = await seedScopedList(FIXTURE);
    try {
      mockSession(ctx.instructor);
      await fn(ctx);
    } finally {
      await cleanupRbac({ userIds: [ctx.instructor.id], courseIds: ctx.allIds });
    }
  }

  const list = (query: string) =>
    new Request(`http://localhost/api/courses?${query}`, { method: "GET" });

  const idsOf = (body: { data: { id: string }[] }) => body.data.map((c) => c.id);

  it("finds a title match that sorts past page 1", async () => {
    await runWithFixture(async ({ ids }) => {
      // Premise: the target is NOT on page 1 of the unfiltered list.
      const page1 = await getCourses(list("page=1&pageSize=2"));
      expect(idsOf(await page1.json())).not.toContain(ids["Search Target Course"]);

      const res = await getCourses(list("page=1&pageSize=2&search=Search%20Target"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Search Target Course"]);
    });
  });

  it("finds a code match that sorts past page 1", async () => {
    await runWithFixture(async ({ ids }) => {
      const res = await getCourses(list("page=1&pageSize=2&search=ZZZ%20400"));
      const body = await res.json();
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Search Target Course"]);
    });
  });

  it("applies the status filter over the whole set, not just page 1", async () => {
    await runWithFixture(async ({ ids }) => {
      const res = await getCourses(list("page=1&pageSize=2&status=draft"));
      const body = await res.json();
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Status Draft Course"]);

      const published = await getCourses(list("page=1&pageSize=2&status=published"));
      expect((await published.json()).total).toBe(6);
    });
  });

  it("ORs values within a group (published OR draft returns the whole set)", async () => {
    await runWithFixture(async () => {
      const res = await getCourses(list("page=1&pageSize=2&status=published&status=draft"));
      expect((await res.json()).total).toBe(7);
    });
  });

  it("applies the term filter by exact term/year pair, past page 1", async () => {
    await runWithFixture(async ({ ids }) => {
      const res = await getCourses(list("page=1&pageSize=2&term=W2::2026"));
      const body = await res.json();
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Term Target Course"]);

      // Same term code, different year — must NOT match the 2026 rows.
      const old = await getCourses(list("page=1&pageSize=2&term=W1::2025"));
      const oldBody = await old.json();
      expect(oldBody.total).toBe(1);
      expect(idsOf(oldBody)).toContain(ids["Old Term Course"]);

      const current = await getCourses(list("page=1&pageSize=2&term=W1::2026"));
      expect((await current.json()).total).toBe(5);
    });
  });

  it("applies the department filter over the whole set, past page 1", async () => {
    await runWithFixture(async ({ ids }) => {
      const res = await getCourses(list("page=1&pageSize=2&department=MATH"));
      const body = await res.json();
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Department Math Course"]);

      const cosc = await getCourses(list("page=1&pageSize=2&department=COSC"));
      expect((await cosc.json()).total).toBe(6);
    });
  });

  it("ANDs across groups (term AND department)", async () => {
    await runWithFixture(async ({ ids }) => {
      const res = await getCourses(list("page=1&pageSize=2&term=W1::2026&department=MATH"));
      const body = await res.json();
      expect(body.total).toBe(1);
      expect(idsOf(body)).toContain(ids["Department Math Course"]);
    });
  });

  it("ANDs across groups (term AND status)", async () => {
    await runWithFixture(async () => {
      const res = await getCourses(list("page=1&pageSize=2&term=W1::2026&status=published"));
      expect((await res.json()).total).toBe(4);
    });
  });

  it("returns an empty page with total 0 for an unknown query", async () => {
    await runWithFixture(async () => {
      const res = await getCourses(list("page=1&pageSize=2&search=does-not-exist"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  it("rejects a malformed status value with a 400", async () => {
    await runWithFixture(async () => {
      const res = await getCourses(list("page=1&pageSize=2&status=banana"));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("FILTER_INVALID");
    });
  });

  it("rejects a malformed term value with a 400", async () => {
    await runWithFixture(async () => {
      const res = await getCourses(list("page=1&pageSize=2&term=not-a-term-key"));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("FILTER_INVALID");
    });
  });

  it("never widens access: filters stay ANDed with the STUDENT publish gate", async () => {
    const { instructor, ids } = await seedScopedList(FIXTURE);
    const student = await seedUser({ role: "STUDENT" });
    // Published enrollment is visible; the draft enrollment must stay hidden.
    await enroll(ids["Filler One"], student.id, "STUDENT");
    await enroll(ids["Status Draft Course"], student.id, "STUDENT");

    try {
      mockSession(student);
      const all = await getCourses(list("page=1&pageSize=10"));
      expect((await all.json()).total).toBe(1);

      const draft = await getCourses(list("page=1&pageSize=10&status=draft"));
      expect((await draft.json()).total).toBe(0);

      const published = await getCourses(list("page=1&pageSize=10&status=published"));
      expect((await published.json()).total).toBe(1);
    } finally {
      await cleanupRbac({
        userIds: [student.id, instructor.id],
        courseIds: [ids["Filler One"], ids["Status Draft Course"], ...Object.values(ids)],
      });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/courses
// ---------------------------------------------------------------------------

describe("POST /api/courses", () => {
  it("returns 403 when instructor create is denied by policy", async () => {
    await setPolicy("instructors.canCreateCourses", false, adminId);
    invalidatePolicyCache();
    try {
      vi.mocked(auth.api.getSession).mockResolvedValue(INSTRUCTOR_SESSION as any);
      const res = await createCourse(makeFormDataPost({
        name: "Forbidden Course",
        code: "FB 001",
        section: "001",
        term: "W1",
        year: 2025,
        startDate: "2025-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    } finally {
      await setPolicy("instructors.canCreateCourses", true, adminId);
      invalidatePolicyCache();
    }
  });

  it("returns 422 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "No Code Course",
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "VALIDATION_ERROR");
  });

  it("returns 422 when instructorUserIds do not resolve to INSTRUCTOR users", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "Bad Instructor Course",
      code: "BI 001",
      section: "001",
      term: "W1",
      year: 2025,
      startDate: "2025-09-01",
      department: "COSC",
      instructorUserIds: adminId,
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "INVALID_INSTRUCTOR");
  });

  it("creates course and INSTRUCTOR enrollment in a transaction", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "Transaction Test Course",
      code: "TX 001",
      section: "002",
      term: "W2",
      // Academic-year label: a Jan-start W2 course attributes to the
      // previous year (#1088) — 2026-01-01 is the second half of 2025.
      year: 2025,
      startDate: "2026-01-01",
      department: "COSC",
      instructorUserIds: instructorId,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("Transaction Test Course");
    createdCourseIds.push(body.id);

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: body.id, userId: instructorId, role: "INSTRUCTOR", isActive: true },
    });
    expect(enrollment).not.toBeNull();
  });

  it("returns 422 with no instructorUserIds and creates no Course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as any);
    const res = await createCourse(makeFormDataPost({
      name: "No Instructor Course",
      code: "NI 001",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: "2026-09-01",
    }));
    // Schema requires >= 1 instructor id → validation failure, nothing persisted.
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toHaveProperty("error", "VALIDATION_ERROR");
    const row = await prisma.course.findFirst({ where: { code: "NI 001" } });
    expect(row).toBeNull();
  });

  it("returns 403 when UNIT_ADMIN creates outside authorizedUnits (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["MATH"] });
    try {
      mockSession(unitAdmin);
      const res = await createCourse(makeFormDataPost({
        name: "Wrong Unit Course",
        code: "WU 001",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: "2026-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "DEPARTMENT_NOT_AUTHORIZED" });
    } finally {
      await cleanupRbac({ userIds: [unitAdmin.id] });
    }
  });

  it("lets UNIT_ADMIN create inside authorizedUnits with instructor enrollment (#298)", async () => {
    const unitAdmin = await seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] });
    try {
      mockSession(unitAdmin);
      const res = await createCourse(makeFormDataPost({
        name: "Unit Admin Course",
        code: "UA 001",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: "2026-09-01",
        department: "COSC",
        instructorUserIds: instructorId,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      createdCourseIds.push(body.id);
      expect(body.department).toBe("COSC");
    } finally {
      await cleanupRbac({ userIds: [unitAdmin.id] });
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/courses/:id (soft-delete)
// ---------------------------------------------------------------------------

describe("DELETE /api/courses/:id", () => {
  it("instructor soft-deletes own course; it disappears from GET /api/courses (#298)", async () => {
    const { deleteCourse } = await import("~/lib/courses/server");
    const instructor = await seedUser({ role: "INSTRUCTOR" });
    const course = await seedCourse({ isPublished: true });
    await enroll(course.id, instructor.id, "INSTRUCTOR");

    try {
      mockSession(instructor);
      const res = await deleteCourse(
        new Request(`http://localhost/api/courses/${course.id}`, { method: "DELETE" }),
        course.id,
      );
      expect(res.status).toBe(204);

      const row = await prisma.course.findUnique({ where: { id: course.id } });
      expect(row?.deletedAt).not.toBeNull();

      mockSession(instructor);
      const list = await getCourses(makeGetRequest());
      const ids = (await list.json()).data.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(course.id);
    } finally {
      await cleanupRbac({ userIds: [instructor.id], courseIds: [course.id] });
    }
  });
});

