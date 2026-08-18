/**
 * #1451 — the enrollment mirrors used to issue one database round trip per row.
 * These run the batched paths against the real database at a realistic roster
 * size and assert the end state is exactly what the per-row loops produced.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("../../src/services/eduaiClient.js", () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
  listEduAiCourses: vi.fn(),
}));

vi.mock("../../src/services/topicSync.js", () => ({
  syncExternalCourseTopics: vi.fn().mockResolvedValue(undefined),
}));

const { listEduAiCourseEnrollmentsServiceKey, listEduAiCourses } =
  await import("../../src/services/eduaiClient.js");
const { syncCourseEnrollments, resetEnrollmentSyncThrottleForTests } =
  await import("../../src/services/enrollmentSync.js");
const { importEnrolledCoursesFromCore } =
  await import("../../src/services/importTaughtCoursesService.js");
const { truncateAll, prisma } = await import("../helpers.js");

const ROSTER_SIZE = 250;
const COURSE_COUNT = 60;

function coreCourses(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `core-course-${i}`,
    callerEnrollmentRole: i % 3 === 0 ? "TA" : "STUDENT",
  }));
}

function coreRoster(size, role) {
  return Array.from({ length: size }, (_, i) => ({
    studentId: `roster-user-${i}`,
    role: typeof role === "function" ? role(i) : role,
    isActive: true,
  }));
}

describe("#1451 enrollment batching at roster size", () => {
  beforeEach(async () => {
    await truncateAll();
    resetEnrollmentSyncThrottleForTests();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await truncateAll();
    await prisma.$disconnect();
  });

  describe("syncCourseEnrollments", () => {
    it("creates, then role-flips, then prunes a full roster correctly", async () => {
      const offering = await prisma.courseOffering.create({
        data: { coreOfferingId: "core-batch-1" },
      });

      // 1. First sync creates every row.
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(coreRoster(ROSTER_SIZE, "STUDENT"));
      const created = await syncCourseEnrollments(offering.id);

      expect(created.created).toBe(ROSTER_SIZE);
      expect(created.updated).toBe(0);
      expect(
        await prisma.courseEnrollment.count({
          where: { courseOfferingId: offering.id, role: "STUDENT" },
        }),
      ).toBe(ROSTER_SIZE);

      // 2. Core promotes the whole roster to TA — one grouped updateMany.
      resetEnrollmentSyncThrottleForTests();
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(coreRoster(ROSTER_SIZE, "TA"));
      const promoted = await syncCourseEnrollments(offering.id);

      expect(promoted.updated).toBe(ROSTER_SIZE);
      expect(
        await prisma.courseEnrollment.count({
          where: { courseOfferingId: offering.id, role: "TA" },
        }),
      ).toBe(ROSTER_SIZE);
      expect(
        await prisma.courseEnrollment.count({
          where: { courseOfferingId: offering.id, role: "STUDENT" },
        }),
      ).toBe(0);

      // 3. Mixed roles land on the right rows.
      resetEnrollmentSyncThrottleForTests();
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(
        coreRoster(ROSTER_SIZE, (i) => (i % 2 === 0 ? "STUDENT" : "TA")),
      );
      await syncCourseEnrollments(offering.id);

      const rows = await prisma.courseEnrollment.findMany({
        where: { courseOfferingId: offering.id },
        select: { userId: true, role: true },
      });
      expect(rows).toHaveLength(ROSTER_SIZE);
      for (const row of rows) {
        const index = Number(row.userId.replace("roster-user-", ""));
        expect(row.role).toBe(index % 2 === 0 ? "STUDENT" : "TA");
      }

      // 4. Half the roster drops out.
      resetEnrollmentSyncThrottleForTests();
      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(
        coreRoster(ROSTER_SIZE / 2, "STUDENT"),
      );
      const pruned = await syncCourseEnrollments(offering.id);

      expect(pruned.deleted).toBe(ROSTER_SIZE / 2);
      expect(
        await prisma.courseEnrollment.count({ where: { courseOfferingId: offering.id } }),
      ).toBe(ROSTER_SIZE / 2);
    });

    it("writes nothing and reports nothing when the roster is unchanged", async () => {
      const offering = await prisma.courseOffering.create({
        data: { coreOfferingId: "core-batch-2" },
      });

      listEduAiCourseEnrollmentsServiceKey.mockResolvedValue(coreRoster(ROSTER_SIZE, "STUDENT"));
      await syncCourseEnrollments(offering.id);

      resetEnrollmentSyncThrottleForTests();
      const second = await syncCourseEnrollments(offering.id);

      expect(second).toEqual({
        synced: ROSTER_SIZE,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: [],
      });
      expect(
        await prisma.courseEnrollment.count({ where: { courseOfferingId: offering.id } }),
      ).toBe(ROSTER_SIZE);
    });
  });

  describe("importEnrolledCoursesFromCore", () => {
    const student = { id: "student-batch-1", role: "STUDENT" };

    it("mirrors a full course load, creating every anchor exactly once", async () => {
      listEduAiCourses.mockResolvedValue(coreCourses(COURSE_COUNT));

      const first = await importEnrolledCoursesFromCore(student, "session=abc");

      expect(first.enrolled).toBe(COURSE_COUNT);
      expect(first.skipped).toBe(0);
      expect(
        await prisma.courseOffering.count({
          where: { coreOfferingId: { startsWith: "core-course-" } },
        }),
      ).toBe(COURSE_COUNT);

      const enrollments = await prisma.courseEnrollment.findMany({
        where: { userId: student.id },
        include: { courseOffering: { select: { coreOfferingId: true } } },
      });
      expect(enrollments).toHaveLength(COURSE_COUNT);
      for (const enrollment of enrollments) {
        const index = Number(enrollment.courseOffering.coreOfferingId.replace("core-course-", ""));
        expect(enrollment.role).toBe(index % 3 === 0 ? "TA" : "STUDENT");
      }
    });

    it("is idempotent — a second mirror creates no duplicate anchors or rows", async () => {
      listEduAiCourses.mockResolvedValue(coreCourses(COURSE_COUNT));
      await importEnrolledCoursesFromCore(student, "session=abc");

      const second = await importEnrolledCoursesFromCore(student, "session=abc");

      expect(second.enrolled).toBe(COURSE_COUNT);
      expect(second.removed).toBe(0);
      expect(
        await prisma.courseOffering.count({
          where: { coreOfferingId: { startsWith: "core-course-" } },
        }),
      ).toBe(COURSE_COUNT);
      expect(await prisma.courseEnrollment.count({ where: { userId: student.id } })).toBe(
        COURSE_COUNT,
      );
    });

    it("applies a Core role change and prunes courses the user left", async () => {
      listEduAiCourses.mockResolvedValue(coreCourses(COURSE_COUNT));
      await importEnrolledCoursesFromCore(student, "session=abc");

      // Every remaining course now reports TA, and half the catalog is gone.
      const remaining = coreCourses(COURSE_COUNT)
        .slice(0, COURSE_COUNT / 2)
        .map((course) => ({ ...course, callerEnrollmentRole: "TA" }));
      listEduAiCourses.mockResolvedValue(remaining);

      const result = await importEnrolledCoursesFromCore(student, "session=abc");

      expect(result.enrolled).toBe(COURSE_COUNT / 2);
      expect(result.removed).toBe(COURSE_COUNT / 2);

      const rows = await prisma.courseEnrollment.findMany({ where: { userId: student.id } });
      expect(rows).toHaveLength(COURSE_COUNT / 2);
      expect(rows.every((row) => row.role === "TA")).toBe(true);
    });
  });
});
