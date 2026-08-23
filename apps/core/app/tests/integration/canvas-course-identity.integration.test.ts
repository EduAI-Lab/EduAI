// @vitest-environment node

import { randomInt } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CANVAS_EXTERNAL_SOURCE } from "~/lib/canvas/client.server";
import { upsertCoreCourseFromCanvas } from "~/lib/canvas/courses.server";
import prisma from "~/lib/prisma.server";

let externalId: string | null = null;
const cleanupCourseIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  if (externalId) {
    await prisma.course.deleteMany({
      where: { externalSource: CANVAS_EXTERNAL_SOURCE, externalId },
    });
  }
  if (cleanupCourseIds.length > 0) {
    await prisma.course.deleteMany({ where: { id: { in: cleanupCourseIds } } });
    cleanupCourseIds.length = 0;
  }
  externalId = null;
});

describe("Canvas course external identity", () => {
  it("rejects a second Core row with the same populated external identity", async () => {
    const canvasId = randomInt(100_000_000, 999_999_999);
    externalId = String(canvasId);

    await prisma.course.create({
      data: {
        code: `RACE ${canvasId} A`,
        name: "Canvas snapshot A",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-09-01T12:00:00Z"),
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId,
      },
    });

    await expect(
      prisma.course.create({
        data: {
          code: `RACE ${canvasId} B`,
          name: "Canvas snapshot B",
          section: "001",
          term: "W1",
          year: 2026,
          startDate: new Date("2026-09-02T12:00:00Z"),
          externalSource: CANVAS_EXTERNAL_SOURCE,
          externalId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("converges concurrent first syncs with differing Canvas snapshots to one Core course", async () => {
    const canvasId = randomInt(100_000_000, 999_999_999);
    externalId = String(canvasId);

    const [first, second] = await Promise.all([
      upsertCoreCourseFromCanvas({
        id: canvasId,
        name: "Concurrent Canvas Course (old snapshot)",
        course_code: `RACE ${canvasId} A`,
        start_at: "2026-09-01T12:00:00Z",
      }),
      upsertCoreCourseFromCanvas({
        id: canvasId,
        name: "Concurrent Canvas Course (new snapshot)",
        course_code: `RACE ${canvasId} B`,
        start_at: "2026-09-02T12:00:00Z",
      }),
    ]);

    expect(second.id).toBe(first.id);
    await expect(
      prisma.course.count({
        where: { externalSource: CANVAS_EXTERNAL_SOURCE, externalId },
      }),
    ).resolves.toBe(1);
  });

  it("adopts the external-identity winner when a losing upsert reports P2002", async () => {
    const canvasId = randomInt(100_000_000, 999_999_999);
    externalId = String(canvasId);
    const winner = await prisma.course.create({
      data: {
        code: `RACE ${canvasId}`,
        name: "Winning Canvas sync",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-09-01T12:00:00Z"),
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId,
      },
    });
    vi.spyOn(prisma.course, "upsert").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const adopted = await upsertCoreCourseFromCanvas({
      id: canvasId,
      name: "Winning Canvas sync (fresh snapshot)",
      course_code: `RACE ${canvasId}`,
      start_at: "2026-09-01T12:00:00Z",
    });

    expect(adopted).toMatchObject({
      id: winner.id,
      name: "Winning Canvas sync (fresh snapshot)",
      isActive: true,
      deletedAt: null,
    });
  });

  it("reactivates the existing Core row when a soft-deleted Canvas course is synced again", async () => {
    const canvasId = randomInt(100_000_000, 999_999_999);
    externalId = String(canvasId);
    const original = await prisma.course.create({
      data: {
        code: `RACE ${canvasId}`,
        name: "Previously unsynced Canvas course",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-09-01T12:00:00Z"),
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId,
        isActive: false,
        isPublished: false,
        deletedAt: new Date("2026-10-01T12:00:00Z"),
      },
    });

    const resynced = await upsertCoreCourseFromCanvas({
      id: canvasId,
      name: "Resynced Canvas course",
      course_code: `RACE ${canvasId}`,
      start_at: "2026-09-01T12:00:00Z",
      workflow_state: "available",
    });

    expect(resynced).toMatchObject({
      id: original.id,
      name: "Resynced Canvas course",
      isActive: true,
      isPublished: true,
      deletedAt: null,
    });
  });

  it("continues to allow multiple ordinary Core courses with no external identity", async () => {
    const nonce = randomInt(100_000_000, 999_999_999);
    const created = await Promise.all([
      prisma.course.create({
        data: {
          code: `CORE ${nonce} A`,
          name: "Ordinary Core course A",
          section: "001",
          term: "W1",
          year: 2026,
          startDate: new Date("2026-09-01T12:00:00Z"),
        },
      }),
      prisma.course.create({
        data: {
          code: `CORE ${nonce} B`,
          name: "Ordinary Core course B",
          section: "001",
          term: "W1",
          year: 2026,
          startDate: new Date("2026-09-01T12:00:00Z"),
        },
      }),
    ]);
    cleanupCourseIds.push(...created.map((course) => course.id));

    expect(created).toHaveLength(2);
    expect(created.every((course) => course.externalSource === null)).toBe(true);
    expect(created.every((course) => course.externalId === null)).toBe(true);
  });
});
