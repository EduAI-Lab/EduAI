/**
 * #1451 — `syncCourseEnrollments` used to issue one database round trip per row.
 * This runs the batched path against the real database at a realistic roster
 * size and asserts the end state is exactly what the per-row loop produced.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("../../src/services/eduaiClient.js", () => ({
  listEduAiCourseEnrollmentsServiceKey: vi.fn(),
}));

const { listEduAiCourseEnrollmentsServiceKey } = await import("../../src/services/eduaiClient.js");
const { syncCourseEnrollments, resetEnrollmentSyncThrottleForTests } =
  await import("../../src/services/enrollmentSync.js");
const { truncateAll, prisma } = await import("../helpers.js");

const ROSTER_SIZE = 250;

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
});
