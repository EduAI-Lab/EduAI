// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ENCRYPTION_KEY = "test-encryption-key-32bytes!!";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    canvasRosterMember: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CANVAS_EXTERNAL_SOURCE: "canvas",
  listCanvasCourseStudents: vi.fn(),
  listCanvasCourseTas: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import {
  listCanvasCourseStudents,
  listCanvasCourseTas,
} from "~/lib/canvas/client.server";
import { syncCourseRoster } from "~/lib/canvas/roster.server";

const credentials = { canvasBaseUrl: "https://canvas.test", apiToken: "tok" } as never;
const SYNC_STARTED_AT = new Date("2026-07-25T00:00:00.000Z");

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    credentials,
    coreCourseId: "course-1",
    canvasCourseId: "555",
    syncedByUserId: "instructor-1",
    syncStartedAt: SYNC_STARTED_AT,
    ...overrides,
  } as never;
}

describe("syncCourseRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("upserts fetched members and then deactivates rows not seen this sync", async () => {
    vi.mocked(listCanvasCourseStudents).mockResolvedValue([
      { id: 101, sis_user_id: "10000001", email: "a@student.ubc.ca", name: "A" },
    ] as never);
    vi.mocked(listCanvasCourseTas).mockResolvedValue([] as never);
    vi.mocked(prisma.canvasRosterMember.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.updateMany).mockResolvedValue({ count: 0 } as never);

    const synced = await syncCourseRoster(baseInput());

    expect(synced).toBe(1);
    expect(prisma.canvasRosterMember.upsert).toHaveBeenCalledTimes(1);
    // The "unseen -> inactive" sweep runs, scoped to rows last seen before this sync.
    expect(prisma.canvasRosterMember.updateMany).toHaveBeenCalledWith({
      where: {
        courseId: "course-1",
        isActive: true,
        lastSeenAt: { lt: SYNC_STARTED_AT },
      },
      data: { isActive: false },
    });
  });

  // CANVAS-01 (#225 / #1195): empty roster with prior active staging must NOT
  // wipe — throw instead of running the deactivation sweep.
  it("refuses to wipe when Canvas returns an empty roster but prior staging exists", async () => {
    vi.mocked(listCanvasCourseStudents).mockResolvedValue([] as never);
    vi.mocked(listCanvasCourseTas).mockResolvedValue([] as never);
    vi.mocked(prisma.canvasRosterMember.count).mockResolvedValue(3);

    await expect(syncCourseRoster(baseInput())).rejects.toThrow(/Refusing to wipe/);

    expect(prisma.canvasRosterMember.upsert).not.toHaveBeenCalled();
    expect(prisma.canvasRosterMember.updateMany).not.toHaveBeenCalled();
  });

  it("returns zero without a sweep when the roster is empty and no prior staging exists", async () => {
    vi.mocked(listCanvasCourseStudents).mockResolvedValue([] as never);
    vi.mocked(listCanvasCourseTas).mockResolvedValue([] as never);
    vi.mocked(prisma.canvasRosterMember.count).mockResolvedValue(0);

    const synced = await syncCourseRoster(baseInput());

    expect(synced).toBe(0);
    expect(prisma.canvasRosterMember.updateMany).not.toHaveBeenCalled();
  });

  // CANVAS-03: a hard fetch failure must NOT wipe staging. The error propagates
  // before the deactivation sweep, so prior active rows survive until a later
  // successful sync.
  it("does not deactivate any rows when the roster fetch throws", async () => {
    vi.mocked(listCanvasCourseStudents).mockRejectedValue(
      new Error("Canvas 500"),
    );
    vi.mocked(listCanvasCourseTas).mockResolvedValue([] as never);

    await expect(syncCourseRoster(baseInput())).rejects.toThrow("Canvas 500");

    expect(prisma.canvasRosterMember.updateMany).not.toHaveBeenCalled();
  });

  // #225 CANVAS-14: unicode / multi-byte display names survive the roster upsert path.
  it("stores unicode display names without corruption during upsert", async () => {
    const unicodeName = "田中 太郎 🎓";
    vi.mocked(listCanvasCourseStudents).mockResolvedValue([
      {
        id: 101,
        sis_user_id: "10000001",
        email: null,
        name: unicodeName,
      },
    ] as never);
    vi.mocked(listCanvasCourseTas).mockResolvedValue([] as never);
    vi.mocked(prisma.canvasRosterMember.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.canvasRosterMember.updateMany).mockResolvedValue({ count: 0 } as never);

    await syncCourseRoster(baseInput());

    expect(prisma.canvasRosterMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          displayName: unicodeName,
          email: null,
        }),
        update: expect.objectContaining({
          displayName: unicodeName,
          email: null,
        }),
      }),
    );
  });
});
