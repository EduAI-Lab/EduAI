// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";

const db = prisma as unknown as {
  course: { findMany: ReturnType<typeof vi.fn> };
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
      where: {},
      select: { code: true },
    });
  });

  it("scopes non-admins to courses they teach, TA, or are actively enrolled in", async () => {
    db.course.findMany.mockResolvedValue([{ code: "COSC 121" }]);

    const codes = await getAccessibleCourseCodes({ id: "u1", role: "STUDENT" });

    expect(codes).toEqual(["COSC 121"]);
    expect(db.course.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { instructorId: "u1" },
          { tas: { some: { userId: "u1" } } },
          { enrollments: { some: { studentId: "u1", isActive: true } } },
        ],
      },
      select: { code: true },
    });
  });

  it("treats a missing role as non-admin (scoped, never global)", async () => {
    db.course.findMany.mockResolvedValue([]);

    await getAccessibleCourseCodes({ id: "u2", role: null });

    const whereArg = db.course.findMany.mock.calls[0][0].where;
    expect(whereArg).toHaveProperty("OR");
    expect(whereArg).not.toEqual({});
  });
});
