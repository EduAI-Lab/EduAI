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
      count: vi.fn(),
      findMany: vi.fn(),
    },
    enrollment: {
      upsert: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import { linkCanvasRoster } from "~/lib/canvas/link-roster.server";
import { prepareStudentIdStorage } from "~/lib/canvas/student-id.server";

describe("LinkRosterSchema", () => {
  it("accepts a student number", () => {
    const result = LinkRosterSchema.safeParse({ studentNumber: " 12345678 " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentNumber).toBe("12345678");
    }
  });

  it("rejects empty student number", () => {
    expect(LinkRosterSchema.safeParse({ studentNumber: "" }).success).toBe(false);
  });
});

describe("isCanvasLinkRosterRateLimited", () => {
  it("allows attempts under the limit", () => {
    const userId = `rate-limit-test-${Date.now()}`;
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
  });
});

describe("linkCanvasRoster without an existing roster sync", () => {
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
    // No instructor has synced Canvas, so there are no staging rows.
    vi.mocked(prisma.canvasRosterMember.count).mockResolvedValue(0 as never);
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
  });
});
