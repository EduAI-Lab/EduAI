// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkRosterSchema } from "~/lib/canvas/schemas";
import { isCanvasLinkRosterRateLimited } from "~/lib/canvas/guards.server";

const TEST_ENCRYPTION_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => {
  const client = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    canvasRosterMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    enrollment: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((run: (tx: typeof client) => Promise<number>) =>
    run(client),
  );
  return { default: client };
});

import prisma from "~/lib/prisma.server";
import { linkCanvasRoster, linkCanvasRosterSelfService } from "~/lib/canvas/link-roster.server";
import { prepareStudentIdStorage } from "~/lib/canvas/student-id.server";

describe("LinkRosterSchema", () => {
  it("accepts a trimmed 8-digit student number", () => {
    const result = LinkRosterSchema.safeParse({ studentNumber: " 12345678 " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentNumber).toBe("12345678");
    }
  });

  it("rejects empty student number", () => {
    expect(LinkRosterSchema.safeParse({ studentNumber: "" }).success).toBe(false);
  });

  it("rejects non-8-digit values (#818)", () => {
    for (const studentNumber of ["9", "1234567", "123456789", "abc12345", "1234567a"]) {
      const result = LinkRosterSchema.safeParse({ studentNumber });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/8 digits/i);
      }
    }
  });
});

describe("isCanvasLinkRosterRateLimited", () => {
  it("allows attempts under the limit", () => {
    const userId = `rate-limit-test-${Date.now()}`;
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
  });
});

describe("Canvas roster linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("saves the student number and links zero enrollments when no staging rows exist", async () => {
    const stored = prepareStudentIdStorage("12345678");

    // 1) linkCanvasRoster reads the current user (no studentId yet).
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      studentId: null,
    } as never);
    // No other account already owns this number.
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    // 2) resolveCanvasEnrollmentsForUser re-reads the now-saved user.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      studentId: stored.studentId,
      studentIdLookup: stored.studentIdLookup,
    } as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);

    const result = await linkCanvasRoster("user-1", "12345678");

    expect(result).toEqual({ studentId: "12345678", enrollmentsLinked: 0 });
    // The student number must be persisted so a later sync can enroll them.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ studentIdLookup: stored.studentIdLookup }),
      }),
    );
    // An admin vouches for the number, so it lands corroborated.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ studentIdVerifiedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.enrollment.upsert).not.toHaveBeenCalled();
    // The administrative path does not gate on a matching staging row.
    expect(prisma.canvasRosterMember.findFirst).not.toHaveBeenCalled();
  });

  /**
   * This used to be a 403 that dead-ended registration for every student whose
   * instructor had not synced their course yet. The number is now stored as an
   * uncorroborated claim instead: no enrollments, no `studentIdVerifiedAt`, and
   * the student lands on the dashboard rather than back on the form.
   */
  it("stores an unmatched self-service number as an uncorroborated claim", async () => {
    const stored = prepareStudentIdStorage("12345678");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        studentId: null,
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: null,
      } as never)
      .mockResolvedValueOnce({
        studentId: stored.studentId,
        studentIdLookup: stored.studentIdLookup,
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: null,
      } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);

    const result = await linkCanvasRosterSelfService(
      "self-service-no-match",
      "STUDENT",
      "12345678",
    );

    expect(result).toEqual({ studentId: "12345678", enrollmentsLinked: 0 });
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "self-service-no-match" },
        data: expect.objectContaining({ studentIdLookup: stored.studentIdLookup }),
      }),
    );

    // The claim must NOT be corroborated — that is what withholds enrollments
    // until a roster row carrying this student's own email turns up.
    expect(vi.mocked(prisma.user.update).mock.calls[0][0]).not.toHaveProperty(
      "data.studentIdVerifiedAt",
    );
    expect(prisma.enrollment.upsert).not.toHaveBeenCalled();
    expect(prisma.enrollment.createMany).not.toHaveBeenCalled();
  });

  it("does not self-link before the account email is verified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      studentId: null,
      email: "student@example.com",
      emailVerified: false,
      studentIdVerifiedAt: null,
    } as never);

    await expect(
      linkCanvasRosterSelfService("self-service-unverified", "STUDENT", "12345678"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.canvasRosterMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("does not expose self-service linking to privileged platform roles", async () => {
    await expect(
      linkCanvasRosterSelfService("self-service-instructor", "INSTRUCTOR", "12345678"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("clears a stale corroboration stamp when a self-service claim changes the number", async () => {
    // A legacy plaintext row is exempt from the reassign guard and was stamped by
    // the backfill, so without clearing, the new number would inherit a stamp it
    // never earned and skip the roster-email check outright.
    const nextStored = prepareStudentIdStorage("87654321");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        studentId: "12345678",
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never)
      .mockResolvedValueOnce({
        studentId: nextStored.studentId,
        studentIdLookup: nextStored.studentIdLookup,
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: null,
      } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);

    await linkCanvasRosterSelfService("legacy-reassign", "STUDENT", "87654321");

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy-reassign" },
        data: expect.objectContaining({
          studentIdLookup: nextStored.studentIdLookup,
          studentIdVerifiedAt: null,
        }),
      }),
    );
  });

  it("keeps the stamp when an administrator changes the number", async () => {
    const nextStored = prepareStudentIdStorage("87654321");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        studentId: "12345678",
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never)
      .mockResolvedValueOnce({
        studentId: nextStored.studentId,
        studentIdLookup: nextStored.studentIdLookup,
        email: "student@example.com",
        emailVerified: true,
        studentIdVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
      } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);

    await linkCanvasRoster("admin-reassign", "87654321");

    expect(vi.mocked(prisma.user.update).mock.calls[0][0]).not.toHaveProperty(
      "data.studentIdVerifiedAt",
    );
  });

  it("self-links and corroborates when an active roster row carries the verified email", async () => {
    const stored = prepareStudentIdStorage("12345678");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        studentId: null,
        email: " Student@Example.com ",
        emailVerified: true,
        studentIdVerifiedAt: null,
      } as never)
      .mockResolvedValueOnce({
        studentId: stored.studentId,
        studentIdLookup: stored.studentIdLookup,
        email: " Student@Example.com ",
        emailVerified: true,
        studentIdVerifiedAt: null,
      } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      {
        courseId: "course-1",
        role: "STUDENT",
        canvasUserId: "101",
        email: "student@example.com",
      },
    ] as never);
    vi.mocked(prisma.enrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.enrollment.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await linkCanvasRosterSelfService("self-service-match", "STUDENT", "12345678");

    expect(result).toEqual({ studentId: "12345678", enrollmentsLinked: 1 });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "self-service-match" },
        data: expect.objectContaining({ studentIdLookup: stored.studentIdLookup }),
      }),
    );

    // The roster row this student's own verified email matches is what
    // corroborates the claim — the same pairing the old up-front 403 demanded,
    // now enforced where the enrollments are actually granted.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "self-service-match" },
      data: { studentIdVerifiedAt: expect.any(Date) },
    });
  });
});
