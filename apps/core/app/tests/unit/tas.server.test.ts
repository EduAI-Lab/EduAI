import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseTA: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  enrollment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import { addCourseTA, getCourseTA } from "~/lib/courses/tas.server";

describe("tas.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCourseTA", () => {
    it("merges CourseTA rows with active TA enrollments", async () => {
      prismaMock.courseTA.findMany.mockResolvedValue([
        {
          id: "cta-1",
          courseId: "c1",
          userId: "u-ta-1",
          createdAt: new Date("2025-01-01"),
          user: { id: "u-ta-1", name: "Sam", email: "sam@test.com" },
        },
      ]);
      prismaMock.enrollment.findMany.mockResolvedValue([
        {
          id: "enr-ta-2",
          courseId: "c1",
          userId: "u-student-ta",
          enrolledAt: new Date("2025-02-01"),
          user: { id: "u-student-ta", name: "Alex", email: "alex@test.com" },
        },
        {
          id: "enr-ta-dup",
          courseId: "c1",
          userId: "u-ta-1",
          enrolledAt: new Date("2025-02-02"),
          user: { id: "u-ta-1", name: "Sam", email: "sam@test.com" },
        },
      ]);

      const tas = await getCourseTA("c1");

      expect(tas).toHaveLength(2);
      expect(tas.map((ta) => ta.userId)).toEqual(["u-ta-1", "u-student-ta"]);
    });
  });

  describe("addCourseTA", () => {
    it("allows platform STUDENT users to become course TAs", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ role: "STUDENT" });
      prismaMock.$transaction.mockImplementation(async (fn) =>
        fn({
          courseTA: {
            upsert: vi.fn().mockResolvedValue({
              id: "cta-new",
              courseId: "c1",
              userId: "u-student",
              user: { id: "u-student", name: "Alex", email: "alex@test.com" },
            }),
          },
          enrollment: {
            upsert: vi.fn().mockResolvedValue({}),
          },
        }),
      );

      const result = await addCourseTA("c1", { userId: "u-student" });

      expect(result).toHaveProperty("ta");
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u-student" },
        select: { role: true },
      });
    });

    it("rejects users whose platform role is INSTRUCTOR", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ role: "INSTRUCTOR" });

      const result = await addCourseTA("c1", { userId: "u-inst" });

      expect(result).toEqual({
        error: "User must be a student or TA to assign as course TA",
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("returns not found when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await addCourseTA("c1", { userId: "missing" });

      expect(result).toEqual({ error: "User not found" });
    });
  });
});
