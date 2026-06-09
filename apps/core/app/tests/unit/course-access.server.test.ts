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
  resolveCourseAccessWithCourse,
  buildCourseListFilter,
  stripAnswerForStudents,
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
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "missing", deletedAt: null },
    });
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

  it("returns null when there is no relationship at all", async () => {
    const access = await resolveCourseAccess({ id: "u1", role: "STUDENT" }, "c1");
    expect(access).toBeNull();
  });

  it("treats platform-level TA role as enrollment-driven (no enrollment → null)", async () => {
    const access = await resolveCourseAccess({ id: "u1", role: "TA" }, "c1");
    expect(access).toBeNull();
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
