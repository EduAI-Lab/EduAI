// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    enrollment: {
      findMany: vi.fn(),
    },
    // `listCoursesForUser` pairs its count + page read in one transaction; the
    // stub resolves the promises the real client would have batched.
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

import prisma from "~/lib/prisma.server";
import { getAccessibleCourseCodes, listCoursesForUser } from "~/lib/courses/server";

const db = prisma as unknown as {
  course: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  enrollment: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAccessibleCourseCodes", () => {
  it("returns every course code for admins (no per-user filter)", async () => {
    db.course.findMany.mockResolvedValue([{ code: "COSC 121" }, { code: "BIOL 200" }]);

    const codes = await getAccessibleCourseCodes({ id: "admin1", role: "ADMIN" });

    expect(codes).toEqual(["COSC 121", "BIOL 200"]);
    expect(db.course.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { code: true },
    });
  });

  it("scopes non-admins to courses they teach, TA, or are actively enrolled in", async () => {
    db.course.findMany.mockResolvedValue([{ code: "COSC 121" }]);

    const codes = await getAccessibleCourseCodes({ id: "u1", role: "STUDENT" });

    expect(codes).toEqual(["COSC 121"]);
    // Scoping is delegated to buildCourseListFilter, which applies the publish
    // gate per ENROLLMENT role: teaching enrollments (INSTRUCTOR/TA) see the
    // course regardless of publish state; a STUDENT enrollment only when published.
    expect(db.course.findMany).toHaveBeenCalledWith({
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
      select: { code: true },
    });
  });

  it("treats a missing role as non-admin (scoped, never global)", async () => {
    db.course.findMany.mockResolvedValue([]);

    await getAccessibleCourseCodes({ id: "u2", role: null });

    const whereArg = db.course.findMany.mock.calls[0][0].where;
    // Non-admins are scoped via an enrollment OR-filter, never the bare
    // global filter that would expose every course.
    expect(whereArg).toHaveProperty("OR");
    expect(whereArg).not.toEqual({ deletedAt: null });
  });
});

/**
 * The dashboard's quick-actions roles only read `total`, so a count-only call
 * must not fetch (or annotate) course rows it throws away. The empty-page guard
 * covers the same waste on a genuinely empty page.
 */
describe("listCoursesForUser", () => {
  it("countOnly reads the total without fetching rows or enrollments", async () => {
    db.course.count.mockResolvedValue(7);

    const result = await listCoursesForUser(
      // `authorizedUnits` inline keeps the filter build off the user table.
      { id: "u1", role: "UNIT_ADMIN", authorizedUnits: ["Science"] },
      { countOnly: true, isActive: true },
    );

    expect(result).toEqual({ courses: [], total: 7 });
    expect(db.course.findMany).not.toHaveBeenCalled();
    expect(db.enrollment.findMany).not.toHaveBeenCalled();
    // The `isActive` narrowing still reaches the count.
    expect(db.course.count.mock.calls[0][0].where).toMatchObject({
      AND: [expect.anything(), { isActive: true }],
    });
  });

  it("skips the enrollment lookup when the page comes back empty", async () => {
    db.course.count.mockResolvedValue(0);
    db.course.findMany.mockResolvedValue([]);

    const result = await listCoursesForUser({ id: "u1", role: "STUDENT" }, { pageSize: 5 });

    expect(result).toEqual({ courses: [], total: 0 });
    expect(db.enrollment.findMany).not.toHaveBeenCalled();
  });

  it("annotates each row with the caller's enrollment role on a non-empty page", async () => {
    db.course.count.mockResolvedValue(2);
    db.course.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    db.enrollment.findMany.mockResolvedValue([{ courseId: "c1", role: "TA" }]);

    const result = await listCoursesForUser({ id: "u1", role: "STUDENT" }, { pageSize: 5 });

    expect(result.total).toBe(2);
    expect(result.courses).toEqual([
      { id: "c1", callerEnrollmentRole: "TA" },
      { id: "c2", callerEnrollmentRole: null },
    ]);
  });
});
