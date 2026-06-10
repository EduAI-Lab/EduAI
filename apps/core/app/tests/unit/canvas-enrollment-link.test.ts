// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

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
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  linkEnrollmentsFromStagingForCourse,
  resolveCanvasEnrollmentsForUser,
} from "~/lib/canvas/enrollment-link.server";

describe("linkEnrollmentsFromStagingForCourse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts enrollments for users with matching studentId", async () => {
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
    vi.mocked(prisma.enrollment.upsert).mockResolvedValue({} as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_userId: { courseId: "course-1", userId: "user-1" } },
        create: expect.objectContaining({
          role: "STUDENT",
          externalSource: "canvas",
          externalId: "101",
        }),
      }),
    );
  });

  it("returns zero when no staging rows exist", async () => {
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([]);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(0);
    expect(prisma.enrollment.upsert).not.toHaveBeenCalled();
  });

  it("links enrollments when roster sisUserId is encrypted at rest", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-32bytes!!");
    const { prepareRosterSisUserIdStorage, prepareStudentIdStorage } = await import(
      "~/lib/canvas/student-id.server"
    );
    const roster = prepareRosterSisUserIdStorage("student_1");
    const user = prepareStudentIdStorage("student_1");

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
    vi.mocked(prisma.enrollment.upsert).mockResolvedValue({} as never);

    const linked = await linkEnrollmentsFromStagingForCourse("course-1");

    expect(linked).toBe(1);
    expect(prisma.enrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ isActive: true }),
      }),
    );
    vi.unstubAllEnvs();
  });
});

describe("resolveCanvasEnrollmentsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links all active staging rows for the user's studentId", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      studentId: "student_2",
      studentIdLookup: null,
    } as never);
    vi.mocked(prisma.canvasRosterMember.findMany).mockResolvedValue([
      { courseId: "course-a", role: "STUDENT", canvasUserId: "202" },
      { courseId: "course-b", role: "TA", canvasUserId: "202" },
    ] as never);
    vi.mocked(prisma.enrollment.upsert).mockResolvedValue({} as never);

    const linked = await resolveCanvasEnrollmentsForUser("user-2");

    expect(linked).toBe(2);
    expect(prisma.enrollment.upsert).toHaveBeenCalledTimes(2);
  });

  it("returns zero when the user has no studentId", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: null } as never);

    const linked = await resolveCanvasEnrollmentsForUser("user-2");

    expect(linked).toBe(0);
    expect(prisma.canvasRosterMember.findMany).not.toHaveBeenCalled();
  });
});
