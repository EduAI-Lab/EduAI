// @vitest-environment node

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const courseUpsert = vi.fn();
  const courseFindUnique = vi.fn();
  const transactionClient = {
    $executeRaw: vi.fn(),
    course: {
      upsert: courseUpsert,
      findUnique: courseFindUnique,
    },
    enrollment: { upsert: vi.fn() },
  };

  return {
    courseUpsert,
    courseFindUnique,
    transactionClient,
    transaction: vi.fn(
      async <Result>(operation: (tx: typeof transactionClient) => Promise<Result>) =>
        operation(transactionClient),
    ),
    courseFindMany: vi.fn(),
    getCanvasIntegration: vi.fn(),
    getCanvasCourseWithTerm: vi.fn(),
    listTeacherCanvasCourses: vi.fn(),
    ensureDefaultBank: vi.fn(),
    ensureCourseHasTopic: vi.fn(),
    syncCourseRoster: vi.fn(),
    linkEnrollments: vi.fn(),
    deactivateEnrollments: vi.fn(),
  };
});

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: mocks.transaction,
    course: { findMany: mocks.courseFindMany },
  },
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CANVAS_EXTERNAL_SOURCE: "canvas",
  getCanvasCourseWithTerm: mocks.getCanvasCourseWithTerm,
  listTeacherCanvasCourses: mocks.listTeacherCanvasCourses,
}));

vi.mock("~/lib/canvas/integration.server", () => ({
  getCanvasIntegrationWithDecryptedKey: mocks.getCanvasIntegration,
}));

vi.mock("~/lib/question-banks/server", () => ({
  ensureDefaultBank: mocks.ensureDefaultBank,
}));

vi.mock("~/lib/topics/fallback.server", () => ({
  ensureCourseHasTopic: mocks.ensureCourseHasTopic,
}));

vi.mock("~/lib/canvas/roster.server", () => ({
  deactivateCourseRoster: vi.fn(),
  syncCourseRoster: mocks.syncCourseRoster,
}));

vi.mock("~/lib/canvas/enrollment-link.server", () => ({
  deactivateDroppedCanvasEnrollments: mocks.deactivateEnrollments,
  linkEnrollmentsFromStagingForCourse: mocks.linkEnrollments,
}));

import { syncCanvasCourses } from "~/lib/canvas/sync.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCanvasIntegration.mockResolvedValue({
    canvasUrl: "https://canvas.test",
    apiKey: "token",
    isTestMode: false,
  });
  mocks.courseFindMany.mockResolvedValue([]);
  mocks.listTeacherCanvasCourses.mockResolvedValue([
    {
      id: 1,
      name: "Algorithms",
      course_code: "CPSC 320",
      start_at: "2026-09-01T12:00:00Z",
    },
  ]);
  mocks.getCanvasCourseWithTerm.mockResolvedValue({
    id: 1,
    name: "Algorithms",
    course_code: "CPSC 320",
    start_at: "2026-09-01T12:00:00Z",
  });
  mocks.transactionClient.$executeRaw.mockResolvedValue(0);
  mocks.transactionClient.enrollment.upsert.mockResolvedValue({ id: "enrollment-1" });
  mocks.ensureDefaultBank.mockResolvedValue({ id: "bank-1" });
  mocks.syncCourseRoster.mockResolvedValue(3);
  mocks.linkEnrollments.mockResolvedValue(2);
  mocks.deactivateEnrollments.mockResolvedValue(undefined);
});

describe("Canvas sync conflict recovery", () => {
  it("retries the full atomic sync in a fresh transaction after P2002", async () => {
    mocks.courseUpsert
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: Prisma.prismaVersion.client,
        }),
      )
      .mockResolvedValueOnce({ id: "core-course-1" });
    mocks.courseFindUnique.mockRejectedValue(new Error("queried aborted transaction"));

    await expect(syncCanvasCourses("instructor-1", ["1"])).resolves.toEqual({
      synced: [
        {
          canvasId: "1",
          coreCourseId: "core-course-1",
          rosterMembersSynced: 3,
          enrollmentsLinked: 2,
        },
      ],
      unsynced: [],
      errors: [],
    });

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.courseUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.courseFindUnique).not.toHaveBeenCalled();
    expect(mocks.syncCourseRoster).toHaveBeenCalledTimes(1);
  });
});
