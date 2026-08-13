// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  enrollment: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import {
  resolveCourseAccess,
  resolveCourseAccessGate,
  resolveCourseAccessWithCourse,
  buildCourseListFilter,
  stripAnswerForStudents,
  getAuthorizedUnits,
  wantsIncludeDeleted,
  GATE_COURSE_SELECT,
  type AccessLevel,
} from "~/lib/auth/course-access.server";

const COURSE = { id: "c1", department: "COSC", isPublished: true, deletedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findFirst.mockResolvedValue(COURSE);
  prismaMock.enrollment.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
});

describe("resolveCourseAccess", () => {
  it("filters soft-deleted courses and returns null when course is missing", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const access = await resolveCourseAccess({ id: "u1", role: "ADMIN" }, "missing");
    expect(access).toBeNull();
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "missing", deletedAt: null } }),
    );
  });

  it("resolves ADMIN to rank 4 without touching enrollments", async () => {
    const access = await resolveCourseAccess({ id: "u1", role: "ADMIN" }, "c1");
    expect(access).toEqual({ level: "admin", rank: 4 });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it("resolves UNIT_ADMIN to rank 3 when department is in authorizedUnits", async () => {
    const access = await resolveCourseAccess(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC", "MATH"] },
      "c1",
    );
    expect(access).toEqual({ level: "unit", rank: 3 });
  });

  it("lazily fetches authorizedUnits from the DB when absent on the user", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const access = await resolveCourseAccess({ id: "u1", role: "UNIT_ADMIN" }, "c1");
    expect(access).toEqual({ level: "unit", rank: 3 });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { authorizedUnits: true },
    });
  });

  it("does NOT match UNIT_ADMIN when course department is null (§19 unit lock)", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ ...COURSE, department: null });
    const access = await resolveCourseAccess(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(access).toBeNull();
  });

  it("does NOT match UNIT_ADMIN outside their authorized units", async () => {
    const access = await resolveCourseAccess(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["MATH"] },
      "c1",
    );
    expect(access).toBeNull();
  });

  it("falls through to enrollment for UNIT_ADMIN outside their units", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    const access = await resolveCourseAccess(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["MATH"] },
      "c1",
    );
    expect(access).toEqual({ level: "student", rank: 0 });
  });

  // Edge-case audit #225 (AUTH-13): UNIT_ADMIN in their unit who is also an active
  // STUDENT enrollment resolves to `unit` (rank 3) — higher platform scope wins.
  it("resolves UNIT_ADMIN in their unit to unit even with an active STUDENT enrollment", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    const access = await resolveCourseAccess(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC", "MATH"] },
      "c1",
    );
    expect(access).toEqual({ level: "unit", rank: 3 });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["INSTRUCTOR", { level: "instructor", rank: 2 }],
    ["TA", { level: "ta", rank: 1 }],
    ["STUDENT", { level: "student", rank: 0 }],
  ])("resolves active %s enrollment", async (enrollmentRole, expected) => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      role: enrollmentRole,
      isActive: true,
    });
    const access = await resolveCourseAccess({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toEqual(expected);
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledWith({
      where: { courseId_userId: { courseId: "c1", userId: "u1" } },
    });
  });

  it("returns null for an inactive enrollment", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: false });
    const access = await resolveCourseAccess({ id: "u1", role: "INSTRUCTOR" }, "c1");
    expect(access).toBeNull();
  });

  // Edge-case audit #225 (AUTH-14): unknown Enrollment.role denies access
  // (fail-closed). Earlier TESTS.md text claiming "other returns student" was wrong.
  it("returns null for an unrecognized enrollment role", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      role: "OBSERVER",
      isActive: true,
    });
    const access = await resolveCourseAccess({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
  });

  it("returns null when there is no relationship at all", async () => {
    const access = await resolveCourseAccess({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
  });

  it("treats platform-level TA role as enrollment-driven (no enrollment → null)", async () => {
    const access = await resolveCourseAccess({ id: "u1", role: "TA" }, "c1");
    expect(access).toBeNull();
  });

  it("does NOT run the UNIT_ADMIN unit-match branch for a non-UNIT_ADMIN role", async () => {
    // A STUDENT whose (irrelevant) authorizedUnits happens to cover the
    // course's department must NOT be granted unit access — that field only
    // matters for role === "UNIT_ADMIN".
    const access = await resolveCourseAccess(
      { id: "u1", role: "STUDENT", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(access).toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("still denies a UNIT_ADMIN a null-department course, speculated units notwithstanding (§19 unit lock)", async () => {
    // The units read is speculated in parallel with the course fetch, so it is
    // issued even on this branch (query counts are pinned in the query-behavior
    // suite below). What the unit lock guarantees is the DECISION: a null
    // department never matches.
    prismaMock.course.findFirst.mockResolvedValue({ ...COURSE, department: null });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const access = await resolveCourseAccess({ id: "u1", role: "UNIT_ADMIN" }, "c1");
    expect(access).toBeNull();
  });

  it("returns null for an enrollment with an unrecognized role", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "BOGUS", isActive: true });
    const { access } = await resolveCourseAccessWithCourse({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
  });
});

// #947: `resolveCourseAccessGate` is the narrow-projection twin of
// `resolveCourseAccessWithCourse`. Both delegate to the same private decision
// helper, so this suite re-walks every role branch through the gate to prove
// the projection did not change any access semantics (rbac-matrix.md §3, §19).
describe("resolveCourseAccessGate", () => {
  it("projects only the gate columns and still filters soft-deleted courses", async () => {
    await resolveCourseAccessGate({ id: "u1", role: "ADMIN" }, "c1");
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", deletedAt: null },
      select: GATE_COURSE_SELECT,
    });
    expect(GATE_COURSE_SELECT).toEqual({
      id: true,
      department: true,
      isPublished: true,
      instructorId: true,
      deletedAt: true,
    });
  });

  it("returns { course: null, access: null } for a missing course", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await resolveCourseAccessGate({ id: "u1", role: "INSTRUCTOR" }, "missing");
    expect(result).toEqual({ course: null, access: null });
  });

  it("returns { course: null, access: null } for a soft-deleted course", async () => {
    // The `deletedAt: null` WHERE clause makes a soft-deleted row invisible, so
    // the query resolves to null exactly as a missing course does.
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await resolveCourseAccessGate(
      { id: "u1", role: "ADMIN" },
      "soft-deleted",
    );
    expect(result).toEqual({ course: null, access: null });
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "soft-deleted", deletedAt: null } }),
    );
  });

  it("resolves ADMIN to rank 4 without reading enrollments", async () => {
    const { course, access } = await resolveCourseAccessGate({ id: "u1", role: "ADMIN" }, "c1");
    expect(access).toEqual({ level: "admin", rank: 4 });
    expect(course).toEqual(COURSE);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it("resolves UNIT_ADMIN in-unit to rank 3 without reading enrollments", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    const { access } = await resolveCourseAccessGate(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(access).toEqual({ level: "unit", rank: 3 });
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it("§19 unit lock: a null department is never a match for UNIT_ADMIN", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ ...COURSE, department: null });
    const { access } = await resolveCourseAccessGate(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(access).toBeNull();
  });

  it("falls through to the enrollment check for UNIT_ADMIN outside their units", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const { access } = await resolveCourseAccessGate(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["MATH"] },
      "c1",
    );
    expect(access).toEqual({ level: "ta", rank: 1 });
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledWith({
      where: { courseId_userId: { courseId: "c1", userId: "u1" } },
    });
  });

  it.each([
    ["INSTRUCTOR", { level: "instructor", rank: 2 }],
    ["TA", { level: "ta", rank: 1 }],
    ["STUDENT", { level: "student", rank: 0 }],
  ])("resolves an active %s enrollment", async (enrollmentRole, expected) => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      role: enrollmentRole,
      isActive: true,
    });
    const { course, access } = await resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toEqual(expected);
    expect(course).toEqual(COURSE);
  });

  it("returns the course but no access for an inactive enrollment (404 vs 403)", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "INSTRUCTOR", isActive: false });
    const { course, access } = await resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
    expect(course).toEqual(COURSE);
  });

  it("does not re-issue the enrollment query when the parallel read found nothing", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    const { access } = await resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);
  });

  it("leaves the publish gate to callers — an unpublished course still resolves student", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ ...COURSE, isPublished: false });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "STUDENT", isActive: true });
    const { course, access } = await resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toEqual({ level: "student", rank: 0 });
    expect(course?.isPublished).toBe(false);
  });

  it("agrees with resolveCourseAccessWithCourse on the access decision", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const user = { id: "u1", role: "STUDENT" };
    const gate = await resolveCourseAccessGate(user, "c1");
    const wide = await resolveCourseAccessWithCourse(user, "c1");
    expect(gate.access).toEqual(wide.access);
  });
});

// #947 / PR #1493 review: the resolver speculates its companion lookups in
// parallel with the course fetch. These tests pin BOTH halves of that bargain —
// the round trip actually saved, and the extra query the speculation costs on
// the paths that used to short-circuit — so neither can drift unnoticed.
describe("resolveCourseAccessGate query behavior", () => {
  /** Holds `course.findFirst` open so we can observe what was issued alongside it. */
  function deferCourseFetch(course: unknown) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    prismaMock.course.findFirst.mockImplementation(async () => {
      await gate;
      return course;
    });
    return release;
  }

  it("starts the UNIT_ADMIN authorized-units lookup without waiting for the course", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const releaseCourse = deferCourseFetch(COURSE);

    const pending = resolveCourseAccessGate({ id: "u1", role: "UNIT_ADMIN" }, "c1");
    await Promise.resolve();

    // The units read is in flight while the course query is still open — it
    // keys on user.id alone and never depended on course.department.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { authorizedUnits: true },
    });

    releaseCourse();
    await expect(pending).resolves.toMatchObject({ access: { level: "unit", rank: 3 } });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("starts the enrollment lookup without waiting for the course (non-admin roles)", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const releaseCourse = deferCourseFetch(COURSE);

    const pending = resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "c1");
    await Promise.resolve();
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);

    releaseCourse();
    await expect(pending).resolves.toMatchObject({ access: { level: "ta", rank: 1 } });
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);
  });

  it("issues no companion query at all for ADMIN", async () => {
    await resolveCourseAccessGate({ id: "u1", role: "ADMIN" }, "c1");
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("skips the units query when the caller already carries authorizedUnits", async () => {
    const { access } = await resolveCourseAccessGate(
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] },
      "c1",
    );
    expect(access).toEqual({ level: "unit", rank: 3 });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  // Documented tradeoff: speculation is not free on paths that previously
  // short-circuited. Each costs exactly one extra query, and no more.
  it("costs one speculated enrollment query on a missing course (tradeoff)", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await resolveCourseAccessGate({ id: "u1", role: "STUDENT" }, "missing");
    expect(result).toEqual({ course: null, access: null });
    // Previously the enrollment read never happened for a missing course.
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("costs one speculated units query on a missing course for UNIT_ADMIN (tradeoff)", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const result = await resolveCourseAccessGate({ id: "u1", role: "UNIT_ADMIN" }, "missing");
    expect(result).toEqual({ course: null, access: null });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it("costs one speculated units query when the §19 unit lock skips the check (tradeoff)", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ ...COURSE, department: null });
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["COSC"] });
    const { access } = await resolveCourseAccessGate({ id: "u1", role: "UNIT_ADMIN" }, "c1");
    expect(access).toBeNull();
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    // Falling through to the enrollment check still issues it lazily, once.
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not re-read units when UNIT_ADMIN falls through to the enrollment check", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: ["MATH"] });
    prismaMock.enrollment.findUnique.mockResolvedValue({ role: "TA", isActive: true });
    const { access } = await resolveCourseAccessGate({ id: "u1", role: "UNIT_ADMIN" }, "c1");
    expect(access).toEqual({ level: "ta", rank: 1 });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("getAuthorizedUnits", () => {
  it("returns [] when the user has no authorizedUnits and the DB row is missing", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const units = await getAuthorizedUnits({ id: "u1" });
    expect(units).toEqual([]);
  });

  it("returns [] when the DB row exists but authorizedUnits is null", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ authorizedUnits: null });
    const units = await getAuthorizedUnits({ id: "u1" });
    expect(units).toEqual([]);
  });
});

describe("wantsIncludeDeleted", () => {
  function requestWith(query: string): Request {
    return new Request(`https://example.com/api/courses${query}`);
  }

  it("is true for ADMIN with includeDeleted=true", () => {
    expect(wantsIncludeDeleted(requestWith("?includeDeleted=true"), { role: "ADMIN" })).toBe(true);
  });

  it("is false for ADMIN without the query param", () => {
    expect(wantsIncludeDeleted(requestWith(""), { role: "ADMIN" })).toBe(false);
  });

  it("is false for a non-ADMIN even when includeDeleted=true", () => {
    expect(wantsIncludeDeleted(requestWith("?includeDeleted=true"), { role: "INSTRUCTOR" })).toBe(
      false,
    );
  });

  it("is false for a null/undefined user", () => {
    expect(wantsIncludeDeleted(requestWith("?includeDeleted=true"), null)).toBe(false);
    expect(wantsIncludeDeleted(requestWith("?includeDeleted=true"), undefined)).toBe(false);
  });
});

describe("resolveCourseAccessWithCourse", () => {
  it("returns the course row alongside access", async () => {
    const { course, access } = await resolveCourseAccessWithCourse(
      { id: "u1", role: "ADMIN" },
      "c1",
    );
    expect(course).toEqual(COURSE);
    expect(access).toEqual({ level: "admin", rank: 4 });
  });

  it("returns { course: null, access: null } for missing course", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await resolveCourseAccessWithCourse({ id: "u1", role: "ADMIN" }, "x");
    expect(result).toEqual({ course: null, access: null });
  });

  it("returns course with null access for an unrelated user (403 vs 404 distinction)", async () => {
    const { course, access } = await resolveCourseAccessWithCourse(
      { id: "u1", role: "STUDENT" },
      "c1",
    );
    expect(course).toEqual(COURSE);
    expect(access).toBeNull();
  });
});

describe("buildCourseListFilter", () => {
  it("ADMIN sees everything not deleted", async () => {
    const where = await buildCourseListFilter({ id: "u1", role: "ADMIN" });
    expect(where).toEqual({ deletedAt: null });
  });

  // #315: ADMIN forensics opt-in drops the deletedAt filter entirely.
  it("ADMIN with includeDeleted sees soft-deleted courses too (no deletedAt filter)", async () => {
    const where = await buildCourseListFilter({ id: "u1", role: "ADMIN" }, true);
    expect(where).toEqual({});
  });

  // #315: the flag is ADMIN-only — a non-ADMIN caller still filters deletedAt.
  it("ignores includeDeleted for non-ADMIN callers", async () => {
    const where = await buildCourseListFilter({ id: "u1", role: "INSTRUCTOR" }, true);
    expect(where.deletedAt).toBeNull();
  });

  it("UNIT_ADMIN sees authorized units plus own enrollments", async () => {
    const where = await buildCourseListFilter({
      id: "u1",
      role: "UNIT_ADMIN",
      authorizedUnits: ["COSC"],
    });
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { department: { in: ["COSC"] } },
      {
        enrollments: {
          some: { userId: "u1", isActive: true, role: { in: ["INSTRUCTOR", "TA"] } },
        },
      },
      {
        isPublished: true,
        enrollments: { some: { userId: "u1", isActive: true, role: "STUDENT" } },
      },
    ]);
  });

  it("applies the publish gate per ENROLLMENT role, not platform role (§1 grad-TA case)", async () => {
    // A UserRole=STUDENT user: unpublished courses visible only via INSTRUCTOR/TA enrollment.
    const where = await buildCourseListFilter({ id: "u1", role: "STUDENT" });
    expect(where).toEqual({
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
    });
  });

  it("uses the same enrollment-scoped filter for INSTRUCTOR platform role", async () => {
    const where = await buildCourseListFilter({ id: "u1", role: "INSTRUCTOR" });
    expect(where.OR).toHaveLength(2);
  });
});

describe("stripAnswerForStudents", () => {
  const QUESTION = { id: "q1", content: "2+2?", answer: "4" };

  it("drops answer for student-level access", () => {
    const access: AccessLevel = { level: "student", rank: 0 };
    const out = stripAnswerForStudents(QUESTION, access);
    expect(out).toEqual({ id: "q1", content: "2+2?" });
    expect("answer" in out).toBe(false);
  });

  it.each([
    ["admin", 4],
    ["unit", 3],
    ["instructor", 2],
    ["ta", 1],
  ] as const)("preserves answer for %s access", (level, rank) => {
    const out = stripAnswerForStudents(QUESTION, { level, rank } as AccessLevel);
    expect(out).toEqual(QUESTION);
  });

  it("preserves answer for null access (service-key / non-student paths)", () => {
    expect(stripAnswerForStudents(QUESTION, null)).toEqual(QUESTION);
  });

  it("no-ops cleanly when answer is null", () => {
    const q = { id: "q1", answer: null };
    const out = stripAnswerForStudents(q, { level: "student", rank: 0 });
    expect("answer" in out).toBe(false);
  });

  it("does not mutate the input object", () => {
    stripAnswerForStudents(QUESTION, { level: "student", rank: 0 });
    expect(QUESTION.answer).toBe("4");
  });
});
