// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ENCRYPTION_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    canvasRosterMember: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    enrollment: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";

/** First argument of a mocked batched write, narrowed for assertions. */
function firstCallArg<T>(mockFn: (...args: never[]) => void): T {
  return vi.mocked(mockFn).mock.calls[0][0] as T;
}
import {
  deactivateDroppedCanvasEnrollments,
  linkEnrollmentsFromStagingForCourse,
  normalizeRosterEmail,
  resolveCanvasEnrollmentsForUser,
} from "~/lib/canvas/enrollment-link.server";

describe("linkEnrollmentsFromStagingForCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates enrollments for users with matching studentId", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-1",
        role: "STUDENT",
        sisUserId: "12345678",
        canvasUserId: "101",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", studentId: "12345678" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
    expect(prisma.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            courseId: "course-1",
            userId: "user-1",
            role: "STUDENT",
            isActive: true,
            externalSource: "canvas",
            externalId: "101",
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it("returns zero when no staging rows exist", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([]);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(0);
    expect(prisma.enrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  // #1451: a re-sync that changes nothing must not write at all.
  it("issues no writes when every roster row already matches its enrollment", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-1",
        role: "STUDENT",
        sisUserId: "12345678",
        canvasUserId: "101",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", studentId: "12345678" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      {
        id: "enr-1",
        courseId: "course-1",
        userId: "user-1",
        role: "STUDENT",
        isActive: true,
        externalId: "101",
        externalSource: "canvas",
      },
    ] as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.enrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  // #1451: rows whose role/isActive/externalId drifted are grouped, not written per row.
  it("groups changed rows into one updateMany per distinct payload", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      { id: "s-a", role: "TA", sisUserId: "11111111", canvasUserId: "401" },
      { id: "s-b", role: "TA", sisUserId: "22222222", canvasUserId: "401" },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-a", studentId: "11111111" },
      { id: "user-b", studentId: "22222222" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      {
        id: "enr-a",
        courseId: "course-1",
        userId: "user-a",
        role: "STUDENT",
        isActive: true,
        externalId: "401",
        externalSource: "canvas",
      },
      {
        id: "enr-b",
        courseId: "course-1",
        userId: "user-b",
        role: "STUDENT",
        isActive: true,
        externalId: "401",
        externalSource: "canvas",
      },
    ] as never);
    vi.mocked(prisma.enrollment.updateMany).mockResolvedValue({ count: 2 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(2);
    expect(prisma.enrollment.createMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["enr-a", "enr-b"] } },
      data: { role: "TA" },
    });
  });

  // #1451: the whole point — write count must not scale with roster size.
  it("keeps write count constant at realistic roster size", async () => {
    const ROSTER_SIZE = 200;
    const rows = Array.from({ length: ROSTER_SIZE }, (_, i) => ({
      id: `staging-${i}`,
      role: "STUDENT",
      sisUserId: `9000${String(i).padStart(4, "0")}`,
      canvasUserId: `canvas-${i}`,
    }));

    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue(
      rows.map((row, i) => ({ id: `user-${i}`, studentId: row.sisUserId })) as never,
    );
    // Half already enrolled with a stale role, half brand new.
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue(
      rows.slice(0, ROSTER_SIZE / 2).map((row, i) => ({
        id: `enr-${i}`,
        courseId: "course-1",
        userId: `user-${i}`,
        role: "TA",
        isActive: true,
        externalId: row.canvasUserId,
        externalSource: "canvas",
      })) as never,
    );
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 100 } as never);
    vi.mocked(prisma.enrollment.updateMany).mockResolvedValue({ count: 1 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(ROSTER_SIZE);
    // 200 roster rows used to cost 200 upserts. Now: one read, one createMany for
    // the 100 new rows, and one updateMany for the 100 that share a role drift.
    expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.enrollment.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(firstCallArg<{ data: unknown[] }>(prisma.enrollment.createMany).data).toHaveLength(
      ROSTER_SIZE / 2,
    );
    expect(
      firstCallArg<{ where: { id: { in: string[] } } }>(prisma.enrollment.updateMany).where.id.in,
    ).toHaveLength(ROSTER_SIZE / 2);
  });

  it("links enrollments when roster sisUserId is encrypted at rest", async () => {
    const { prepareRosterSisUserIdStorage, prepareStudentIdStorage } =
      await import("~/lib/canvas/student-id.server");
    const roster = prepareRosterSisUserIdStorage("10000001");
    const user = prepareStudentIdStorage("10000001");

    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-1",
        role: "STUDENT",
        sisUserId: roster.sisUserId,
        canvasUserId: "101",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", studentId: user.studentId },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: "user-1", isActive: true })],
      }),
    );
  });

  // #225 CANVAS-09: duplicate email/sis across Canvas users; null email links by sis only.
  it("links a student with null email when sisUserId matches", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-null-email",
        role: "STUDENT",
        sisUserId: "87654321",
        canvasUserId: "303",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-null-email", studentId: "87654321" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ courseId: "course-1", userId: "user-null-email" })],
      }),
    );
  });

  it("links both users when two Canvas accounts share an email but have distinct sis ids", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-a",
        role: "STUDENT",
        sisUserId: "11111111",
        canvasUserId: "401",
      },
      {
        id: "staging-b",
        role: "STUDENT",
        sisUserId: "22222222",
        canvasUserId: "402",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-a", studentId: "11111111" },
      { id: "user-b", studentId: "22222222" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 2 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(2);
    expect(prisma.enrollment.createMany).toHaveBeenCalledTimes(1);
    expect(firstCallArg<{ data: unknown[] }>(prisma.enrollment.createMany).data).toHaveLength(2);
  });

  // #1451: the per-row upsert loop wrote this enrollment twice and counted it twice.
  // Batching dedupes by (courseId, userId) keeping the LAST row, so the DB end state
  // is unchanged (canvasUserId 502 still wins) but the count is now 1, not 2.
  it("collapses duplicate sis ids onto one enrollment, keeping the last Canvas user id", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        id: "staging-dup-a",
        role: "STUDENT",
        sisUserId: "33333333",
        canvasUserId: "501",
      },
      {
        id: "staging-dup-b",
        role: "STUDENT",
        sisUserId: "33333333",
        canvasUserId: "502",
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-dup", studentId: "33333333" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.enrollment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            courseId: "course-1",
            userId: "user-dup",
            externalId: "502",
          }),
        ],
      }),
    );
  });
});

describe("resolveCanvasEnrollmentsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links all active staging rows for the user's studentId", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      studentId: "10000002",
      studentIdLookup: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      { courseId: "course-a", role: "STUDENT", canvasUserId: "202" },
      { courseId: "course-b", role: "TA", canvasUserId: "202" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 2 } as never);

    const linked = await resolveCanvasEnrollmentsForUser("user-2");

    expect(linked).toBe(2);
    expect(prisma.enrollment.createMany).toHaveBeenCalledTimes(1);
    expect(firstCallArg<{ data: unknown[] }>(prisma.enrollment.createMany).data).toEqual([
      expect.objectContaining({ courseId: "course-a", userId: "user-2", role: "STUDENT" }),
      expect.objectContaining({ courseId: "course-b", userId: "user-2", role: "TA" }),
    ]);
  });

  it("returns zero when the user has no studentId", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: null } as never);

    const linked = await resolveCanvasEnrollmentsForUser("user-2");

    expect(linked).toBe(0);
    expect(prisma.canvasRosterMember.findMany).not.toHaveBeenCalled();
  });

  it("does not replay as upserts when createMany inserted every row", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      studentId: "10000002",
      studentIdLookup: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      { courseId: "course-a", role: "STUDENT", canvasUserId: "202" },
      { courseId: "course-b", role: "TA", canvasUserId: "202" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 2 } as never);

    await resolveCanvasEnrollmentsForUser("user-2");

    expect(prisma.enrollment.upsert).not.toHaveBeenCalled();
  });

  it("replays the batch as upserts when a concurrent writer wins the create race", async () => {
    // `createMany({ skipDuplicates })` silently drops our values for a row another
    // writer inserted after our read, which the per-row upsert this replaced could
    // not do. A short count is the only signal, so it has to trigger the replay.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      studentId: "10000002",
      studentIdLookup: null,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      { courseId: "course-a", role: "STUDENT", canvasUserId: "202" },
      { courseId: "course-b", role: "TA", canvasUserId: "202" },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.enrollment.upsert).mockResolvedValue({} as never);

    const linked = await resolveCanvasEnrollmentsForUser("user-2");

    expect(linked).toBe(2);
    expect(prisma.enrollment.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_userId: { courseId: "course-b", userId: "user-2" } },
        update: expect.objectContaining({ role: "TA", externalId: "202", isActive: true }),
      }),
    );
  });
});

// Edge-case audit #225 (CANVAS-02): dropped-member reconciliation had no coverage.
describe("deactivateDroppedCanvasEnrollments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function storage() {
    const { prepareRosterSisUserIdStorage, prepareStudentIdStorage } =
      await import("~/lib/canvas/student-id.server");
    return { prepareRosterSisUserIdStorage, prepareStudentIdStorage };
  }

  it("deactivates canvas enrollments for users no longer on the active roster", async () => {
    const { prepareRosterSisUserIdStorage, prepareStudentIdStorage } = await storage();
    // Only the student who remains ("10000001") is still in active staging.
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        sisUserId: prepareRosterSisUserIdStorage("10000001").sisUserId,
        canvasUserId: "101",
      },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      {
        id: "enr-stays",
        user: { studentId: prepareStudentIdStorage("10000001").studentId },
      },
      {
        id: "enr-dropped",
        user: { studentId: prepareStudentIdStorage("20000002").studentId },
      },
    ] as never);
    vi.mocked(prisma.enrollment.updateMany).mockResolvedValue({ count: 1 } as never);

    const deactivated = await deactivateDroppedCanvasEnrollments("course-1");

    expect(deactivated).toBe(1);
    expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["enr-dropped"] } },
      data: { isActive: false },
    });
  });

  it("does not deactivate when every enrolled user is still on the roster", async () => {
    const { prepareRosterSisUserIdStorage, prepareStudentIdStorage } = await storage();
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        sisUserId: prepareRosterSisUserIdStorage("10000001").sisUserId,
        canvasUserId: "101",
      },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      {
        id: "enr-stays",
        user: { studentId: prepareStudentIdStorage("10000001").studentId },
      },
    ] as never);

    const deactivated = await deactivateDroppedCanvasEnrollments("course-1");

    expect(deactivated).toBe(0);
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it("skips enrollments whose user has no resolvable studentId", async () => {
    // Empty active staging plus an enrollment with a null studentId: the null
    // user must not be swept (we cannot prove they were dropped).
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([
      { id: "enr-null", user: { studentId: null } },
    ] as never);

    const deactivated = await deactivateDroppedCanvasEnrollments("course-1");

    expect(deactivated).toBe(0);
    expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
  });
});

// #225 CANVAS-09: normalizeRosterEmail used during roster staging, not enrollment linking.
describe("normalizeRosterEmail (#225 CANVAS-09)", () => {
  it("returns null for null, undefined, empty, or whitespace-only values", () => {
    expect(normalizeRosterEmail(null)).toBeNull();
    expect(normalizeRosterEmail(undefined)).toBeNull();
    expect(normalizeRosterEmail("")).toBeNull();
    expect(normalizeRosterEmail("   ")).toBeNull();
  });

  it("lowercases and trims a valid email", () => {
    expect(normalizeRosterEmail("  Student@UBC.CA ")).toBe("student@ubc.ca");
  });
});
