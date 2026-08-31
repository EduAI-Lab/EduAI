// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkRosterSchema } from "~/lib/canvas/schemas";
import { isCanvasLinkRosterRateLimited } from "~/lib/canvas/guards.server";

const TEST_ENCRYPTION_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => ({
  default: {
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
    },
  },
}));

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
    expect(prisma.enrollment.upsert).not.toHaveBeenCalled();
    // The administrative path does not gate on a matching staging row.
    expect(prisma.canvasRosterMember.findFirst).not.toHaveBeenCalled();
  });

  it("does not self-link an identifier without a matching active roster identity", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      studentId: null,
      email: "student@example.com",
      emailVerified: true,
    } as never);
    vi.mocked(prisma.canvasRosterMember.findFirst).mockResolvedValue(null as never);

    await expect(
      linkCanvasRosterSelfService("self-service-no-match", "STUDENT", "12345678"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("does not self-link before the account email is verified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      studentId: null,
      email: "student@example.com",
      emailVerified: false,
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

  it("self-links when the verified email and student number match an active roster row", async () => {
    const stored = prepareStudentIdStorage("12345678");
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        studentId: null,
        email: " Student@Example.com ",
        emailVerified: true,
      } as never)
      .mockResolvedValueOnce({
        studentId: stored.studentId,
        studentIdLookup: stored.studentIdLookup,
      } as never);
    vi.mocked(prisma.canvasRosterMember.findFirst).mockResolvedValue({ id: "roster-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([] as never);

    const result = await linkCanvasRosterSelfService("self-service-match", "STUDENT", "12345678");

    expect(result).toEqual({ studentId: "12345678", enrollmentsLinked: 0 });
    expect(prisma.canvasRosterMember.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        isActive: true,
        email: { equals: "student@example.com", mode: "insensitive" },
      }),
      select: { id: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "self-service-match" } }),
    );
  });
});
