import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  STUDENT_ID_ONBOARDING_ROLES,
  userNeedsStudentIdOnboarding,
} from "~/lib/canvas/onboarding.server";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";

describe("userNeedsStudentIdOnboarding", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
  });

  it("returns false for roles outside STUDENT/TA", async () => {
    expect(await userNeedsStudentIdOnboarding("u1", "INSTRUCTOR")).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns true when a student has no linked student number", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: null } as never);

    expect(await userNeedsStudentIdOnboarding("u1", "STUDENT")).toBe(true);
    expect(STUDENT_ID_ONBOARDING_ROLES.has("STUDENT")).toBe(true);
  });

  it("returns false when a student already linked a student number", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: "student_1" } as never);

    expect(await userNeedsStudentIdOnboarding("u1", "STUDENT")).toBe(false);
  });
});
