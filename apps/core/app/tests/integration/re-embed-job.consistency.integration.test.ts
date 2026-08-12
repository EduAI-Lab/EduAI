// @vitest-environment node
//
// Failure-injection + consistency integration tests for #1112.
// Real Postgres; embedding work mocked so we only exercise start/claim/compensate.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { seedUser, seedCourse, enroll, cleanupRbac } from "../helpers/rbac";

vi.mock("~/lib/ai/embedding", () => ({
  reEmbedCourseMaterials: vi.fn(async () => ({ processed: 0, failed: [], total: 0 })),
}));

import { startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

let instructorId: string;
let courseAId: string;
let courseBId: string;

beforeAll(async () => {
  const instructor = await seedUser({ role: "INSTRUCTOR" });
  instructorId = instructor.id;
  const courseA = await seedCourse({ name: "ReEmbed Consistency A" });
  const courseB = await seedCourse({ name: "ReEmbed Consistency B" });
  courseAId = courseA.id;
  courseBId = courseB.id;
  await enroll(courseAId, instructorId, "INSTRUCTOR");
  await enroll(courseBId, instructorId, "INSTRUCTOR");
});

afterAll(async () => {
  await prisma.courseReEmbedJob.deleteMany({
    where: { courseId: { in: [courseAId, courseBId] } },
  });
  await cleanupRbac({ userIds: [instructorId], courseIds: [courseAId, courseBId] });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.courseReEmbedJob.deleteMany({
    where: { courseId: { in: [courseAId, courseBId] } },
  });
});

describe("startReEmbedJob consistency integration (#1112)", () => {
  it("idempotent retry with the same key returns the same row (no duplicate)", async () => {
    const first = await startReEmbedJob(courseAId, { idempotencyKey: "idem-shared" });
    expect(first.created).toBe(true);

    const second = await startReEmbedJob(courseAId, { idempotencyKey: "idem-shared" });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    const count = await prisma.courseReEmbedJob.count({
      where: { courseId: courseAId, idempotencyKey: "idem-shared" },
    });
    expect(count).toBe(1);
  });

  it("scopes idempotency keys per course (same key on another course is independent)", async () => {
    const a = await startReEmbedJob(courseAId, { idempotencyKey: "cross-course-key" });
    const b = await startReEmbedJob(courseBId, { idempotencyKey: "cross-course-key" });
    expect(a.job.id).not.toBe(b.job.id);
    expect(a.job.courseId).toBe(courseAId);
    expect(b.job.courseId).toBe(courseBId);
  });

  it("concurrent duplicate requests with the same key create exactly one row", async () => {
    const key = "concurrent-key";
    const results = await Promise.all([
      startReEmbedJob(courseAId, { idempotencyKey: key }),
      startReEmbedJob(courseAId, { idempotencyKey: key }),
      startReEmbedJob(courseAId, { idempotencyKey: key }),
    ]);
    const ids = new Set(results.map((r) => r.job.id));
    expect(ids.size).toBe(1);
    const count = await prisma.courseReEmbedJob.count({
      where: { courseId: courseAId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("compensates (no orphan PENDING) when the claim boundary fails after create", async () => {
    const realUpdate = prisma.courseReEmbedJob.update.bind(prisma.courseReEmbedJob);
    const spy = vi.spyOn(prisma.courseReEmbedJob, "update").mockImplementation(((args: any) => {
      if (args?.data?.status === "RUNNING") {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError("operations timed out", {
            code: "P1008",
            clientVersion: "6",
          }),
        );
      }
      return realUpdate(args);
    }) as unknown as typeof prisma.courseReEmbedJob.update);

    try {
      await expect(startReEmbedJob(courseAId)).rejects.toBeInstanceOf(QueueUnavailableError);
      const orphans = await prisma.courseReEmbedJob.count({
        where: { courseId: courseAId, status: "PENDING" },
      });
      expect(orphans).toBe(0);
      const total = await prisma.courseReEmbedJob.count({ where: { courseId: courseAId } });
      expect(total).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("reclaims a stale RUNNING row (no progress in 30+ minutes) and starts fresh (#1269 review)", async () => {
    const stuck = await prisma.courseReEmbedJob.create({
      data: {
        courseId: courseAId,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 45 * 60 * 1000),
      },
    });
    // `updatedAt` is Prisma-managed on `.update()`/`.create()`, so backdate it
    // directly via raw SQL to simulate a row that's had no progress in 45
    // minutes without racing the fire-and-forget `executeReEmbedJob` path.
    await prisma.$executeRaw`UPDATE course_re_embed_jobs SET "updatedAt" = ${new Date(Date.now() - 45 * 60 * 1000)} WHERE id = ${stuck.id}`;

    const result = await startReEmbedJob(courseAId);

    expect(result.created).toBe(true);
    expect(result.job.id).not.toBe(stuck.id);

    const reclaimed = await prisma.courseReEmbedJob.findUnique({ where: { id: stuck.id } });
    expect(reclaimed?.status).toBe("FAILED");
  });

  it("does not reclaim a RUNNING row with recent progress", async () => {
    const active = await prisma.courseReEmbedJob.create({
      data: { courseId: courseAId, status: "RUNNING", startedAt: new Date() },
    });

    const result = await startReEmbedJob(courseAId);

    expect(result.created).toBe(false);
    expect(result.job.id).toBe(active.id);
  });

  it("replays a terminal row on the same idempotencyKey within the retry window instead of starting new work (#1269 review)", async () => {
    const key = "terminal-replay-key";
    const done = await prisma.courseReEmbedJob.create({
      data: {
        courseId: courseAId,
        status: "COMPLETED",
        idempotencyKey: key,
        completedAt: new Date(),
      },
    });

    const result = await startReEmbedJob(courseAId, { idempotencyKey: key });

    // An immediate idempotency retry must return the same finished job, not
    // spend another re-embed run — that is what the Idempotency-Key contract
    // promises the caller.
    expect(result.job.id).toBe(done.id);
    expect(result.created).toBe(false);
    expect(result.job.status).toBe("COMPLETED");
  });

  it("recycles a terminal row on the same idempotencyKey once the replay window has passed (#1269 review)", async () => {
    const key = "terminal-recycle-key";
    const done = await prisma.courseReEmbedJob.create({
      data: {
        courseId: courseAId,
        status: "COMPLETED",
        idempotencyKey: key,
        completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    // completedAt is Prisma-managed like updatedAt on writes after create, so
    // backdate directly via raw SQL (same pattern as the stale-RUNNING test).
    await prisma.$executeRaw`UPDATE course_re_embed_jobs SET "completedAt" = ${new Date(Date.now() - 25 * 60 * 60 * 1000)}, "updatedAt" = ${new Date(Date.now() - 25 * 60 * 60 * 1000)} WHERE id = ${done.id}`;

    const result = await startReEmbedJob(courseAId, { idempotencyKey: key });

    expect(result.job.id).toBe(done.id);
    expect(result.created).toBe(true);
    expect(result.job.status).not.toBe("COMPLETED");

    const count = await prisma.courseReEmbedJob.count({
      where: { courseId: courseAId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it("attaches the caller's idempotencyKey to an active job found without a key match (#1269 review)", async () => {
    const active = await prisma.courseReEmbedJob.create({
      data: { courseId: courseAId, status: "RUNNING", startedAt: new Date() },
    });

    const result = await startReEmbedJob(courseAId, { idempotencyKey: "attach-me" });
    expect(result.job.id).toBe(active.id);

    // A later request using only the key (no course-wide active job left)
    // should still find this row rather than starting a duplicate.
    const byKey = await prisma.courseReEmbedJob.findUnique({
      where: { courseId_idempotencyKey: { courseId: courseAId, idempotencyKey: "attach-me" } },
    });
    expect(byKey?.id).toBe(active.id);
  });
});
