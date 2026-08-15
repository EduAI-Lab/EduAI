// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

const findFirst = vi.hoisted(() => vi.fn());
const findUnique = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseReEmbedJob: {
      findFirst,
      findUnique,
      create,
      update,
      delete: del,
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  reEmbedCourseMaterials: vi.fn(async () => ({ processed: 0, failed: [], total: 0 })),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import { startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { logSystemError } from "~/lib/logging.server";

const baseJob = {
  id: "job_1",
  courseId: "course_1",
  idempotencyKey: null as string | null,
  status: "PENDING" as const,
  totalMaterials: 0,
  processedCount: 0,
  failedMaterialIds: [] as string[],
  currentMaterialTitle: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const claimedJob = {
  ...baseJob,
  status: "RUNNING" as const,
  startedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
  findUnique.mockResolvedValue(null);
  create.mockResolvedValue(baseJob);
  update.mockResolvedValue(claimedJob);
  del.mockResolvedValue({});
});

describe("startReEmbedJob consistency (#1112)", () => {
  it("creates a PENDING job, awaits claim to RUNNING, and reports created=true", async () => {
    const result = await startReEmbedJob("course_1");
    expect(result.created).toBe(true);
    expect(result.job.id).toBe("job_1");
    expect(result.job.status).toBe("RUNNING");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseId: "course_1", status: "PENDING" }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job_1" },
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
  });

  it("reuses an active job without creating another", async () => {
    findFirst.mockResolvedValueOnce({ ...baseJob, id: "active_1", status: "RUNNING" });
    const result = await startReEmbedJob("course_1");
    expect(result).toEqual({
      job: expect.objectContaining({ id: "active_1" }),
      created: false,
      keyHonored: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("reuses a row with the same course-scoped idempotencyKey", async () => {
    findUnique.mockResolvedValueOnce({
      ...baseJob,
      id: "idem_1",
      courseId: "course_1",
      idempotencyKey: "k1",
    });
    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });
    expect(result.created).toBe(false);
    expect(result.job.id).toBe("idem_1");
    expect(findUnique).toHaveBeenCalledWith({
      where: { courseId_idempotencyKey: { courseId: "course_1", idempotencyKey: "k1" } },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not reuse an idempotencyKey belonging to another course", async () => {
    // Compound lookup for (course_1, k1) misses — create a new job for this course.
    findUnique.mockResolvedValueOnce(null);
    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });
    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courseId: "course_1", idempotencyKey: "k1" }),
      }),
    );
  });

  it("returns the winning row on idempotencyKey race (P2002)", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["courseId", "idempotencyKey"] },
    });
    create.mockRejectedValueOnce(conflict);
    findUnique
      .mockResolvedValueOnce(null) // initial key lookup
      .mockResolvedValueOnce({
        ...baseJob,
        id: "winner",
        courseId: "course_1",
        idempotencyKey: "k1",
      });

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });
    expect(result).toEqual({
      job: expect.objectContaining({ id: "winner" }),
      created: false,
      keyHonored: true,
    });
  });

  it("compensates the PENDING row when the durable claim boundary fails", async () => {
    const dbDown = new Prisma.PrismaClientKnownRequestError("timeout", {
      code: "P1008",
      clientVersion: "6",
    });
    update.mockRejectedValueOnce(dbDown);
    await expect(startReEmbedJob("course_1")).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(del).toHaveBeenCalledWith({ where: { id: "job_1" } });
  });

  it("wraps DB unreachable errors as QueueUnavailableError", async () => {
    const dbDown = new Prisma.PrismaClientKnownRequestError("cant reach", {
      code: "P1001",
      clientVersion: "6",
    });
    create.mockRejectedValueOnce(dbDown);
    await expect(startReEmbedJob("course_1")).rejects.toBeInstanceOf(QueueUnavailableError);
  });

  it("reclaims a stale RUNNING row (no progress in 30+ minutes) instead of returning it as active", async () => {
    const staleUpdatedAt = new Date(Date.now() - 45 * 60 * 1000);
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "stuck_1",
      status: "RUNNING",
      startedAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    });

    const result = await startReEmbedJob("course_1");

    // The stale row gets marked FAILED (reclaim)...
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stuck_1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    // ...and a fresh job starts instead of returning the stuck one.
    expect(create).toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(result.job.id).not.toBe("stuck_1");
  });

  it("surfaces 503 and does not start a new job when reclaiming a stale RUNNING row hits an infra failure", async () => {
    const staleUpdatedAt = new Date(Date.now() - 45 * 60 * 1000);
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "stuck_1",
      status: "RUNNING",
      startedAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    });
    update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("timeout", { code: "P1008", clientVersion: "6" }),
    );

    // The old RUNNING row must not be treated as reclaimed when the FAILED
    // write itself fails (#1269 review) — otherwise create() below could
    // start a second active job on top of a row that's still live.
    await expect(startReEmbedJob("course_1")).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it("reclaims a stale PENDING row (stuck for over 5 minutes) instead of blocking every future start (#1269 review)", async () => {
    // A crash between create() and claimReEmbedJob (or a claim whose
    // compensating delete also failed) can leave a row PENDING forever with
    // no recovery — findActiveReEmbedJob treats PENDING as active, and only
    // RUNNING rows had a stale-reclaim path before this fix.
    const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000);
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "stuck_pending_1",
      status: "PENDING",
      createdAt: staleCreatedAt,
      updatedAt: staleCreatedAt,
    });

    const result = await startReEmbedJob("course_1");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stuck_pending_1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(create).toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(result.job.id).not.toBe("stuck_pending_1");
  });

  it("does not reclaim a PENDING row still within the claim window", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "fresh_pending_1",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await startReEmbedJob("course_1");

    expect(result).toEqual({
      job: expect.objectContaining({ id: "fresh_pending_1" }),
      created: false,
      keyHonored: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("logs (does not swallow) a failure to compensate-delete the PENDING row after a claim failure", async () => {
    const dbDown = new Prisma.PrismaClientKnownRequestError("timeout", {
      code: "P1008",
      clientVersion: "6",
    });
    update.mockRejectedValueOnce(dbDown); // claimReEmbedJob fails
    const deleteError = new Error("delete also failed");
    del.mockRejectedValueOnce(deleteError); // compensating delete fails too

    // The original claim failure still surfaces — the delete failure must
    // not replace or mask it (#1269 review).
    await expect(startReEmbedJob("course_1")).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(logSystemError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "re_embed_job_compensate_delete_failed",
        error: deleteError,
      }),
    );
  });

  it("recycles a stale RUNNING row found by idempotencyKey directly, instead of falling through to a duplicate-key create (#1269 review)", async () => {
    const staleUpdatedAt = new Date(Date.now() - 45 * 60 * 1000);
    findUnique.mockResolvedValueOnce({
      ...baseJob,
      id: "stuck_keyed_1",
      idempotencyKey: "k1",
      status: "RUNNING",
      startedAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    });
    update
      .mockResolvedValueOnce({}) // reclaimStaleReEmbedJob: FAILED
      .mockResolvedValueOnce({
        ...baseJob,
        id: "stuck_keyed_1",
        idempotencyKey: "k1",
        status: "PENDING",
      }) // recycleReEmbedJob: PENDING
      .mockResolvedValueOnce({
        ...baseJob,
        id: "stuck_keyed_1",
        idempotencyKey: "k1",
        status: "RUNNING",
        startedAt: new Date(),
      }); // claimReEmbedJob: RUNNING

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    // Recycled the same row (never a second create() on the same key, which
    // would have hit the compound unique constraint).
    expect(create).not.toHaveBeenCalled();
    expect(result.created).toBe(true);
    expect(result.job.id).toBe("stuck_keyed_1");
  });

  it("does not reclaim a RUNNING row with recent progress", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "active_1",
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await startReEmbedJob("course_1");

    expect(result).toEqual({
      job: expect.objectContaining({ id: "active_1" }),
      created: false,
      keyHonored: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("replays a terminal row on the same idempotencyKey within the retry window", async () => {
    // Fast path: the key lookup finds a recently-COMPLETED row. Not an
    // active status, but within IDEMPOTENCY_KEY_REPLAY_TTL_MS, so this must
    // replay the finished job rather than start new work.
    findUnique.mockResolvedValueOnce({
      ...baseJob,
      id: "done_1",
      idempotencyKey: "k1",
      status: "COMPLETED",
      completedAt: new Date(),
    });

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: expect.objectContaining({ id: "done_1" }),
      created: false,
      keyHonored: true,
    });
  });

  it("recycles a terminal row on the same idempotencyKey once the replay window has passed", async () => {
    const staleCompletedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    // Fast path: the key lookup finds a COMPLETED row well past the replay
    // window, so it falls through to create() instead of replaying it.
    findUnique.mockResolvedValueOnce({
      ...baseJob,
      id: "done_1",
      idempotencyKey: "k1",
      status: "COMPLETED",
      completedAt: staleCompletedAt,
    });
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["courseId", "idempotencyKey"] },
    });
    create.mockRejectedValueOnce(conflict);
    // Conflict handler re-looks-up the same terminal row.
    findUnique.mockResolvedValueOnce({
      ...baseJob,
      id: "done_1",
      idempotencyKey: "k1",
      status: "COMPLETED",
      completedAt: staleCompletedAt,
    });
    update.mockResolvedValueOnce({ ...baseJob, id: "done_1", idempotencyKey: "k1", status: "PENDING" });
    update.mockResolvedValueOnce({
      ...baseJob,
      id: "done_1",
      idempotencyKey: "k1",
      status: "RUNNING",
      startedAt: new Date(),
    });

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    // Recycled into PENDING (reset progress fields) rather than returned as COMPLETED.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "done_1" },
        data: expect.objectContaining({ status: "PENDING", processedCount: 0 }),
      }),
    );
    expect(result.created).toBe(true);
    expect(result.job.id).toBe("done_1");
  });

  it("attaches the caller's idempotencyKey to an active job found without a key match", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "active_1",
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey: null,
    });

    await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    expect(update).toHaveBeenCalledWith({
      where: { id: "active_1" },
      data: { idempotencyKey: "k1" },
    });
  });

  it("surfaces 503 when persisting the caller's idempotencyKey onto an active job hits an infra failure", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "active_1",
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey: null,
    });
    update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("timeout", { code: "P1008", clientVersion: "6" }),
    );

    // Must not silently return the active job as if the key attach
    // succeeded (#1269 review) — a later retry on that key would miss it.
    await expect(startReEmbedJob("course_1", { idempotencyKey: "k1" })).rejects.toBeInstanceOf(
      QueueUnavailableError,
    );
  });

  it("does not overwrite an existing idempotencyKey already on the active job, and reports keyHonored: false (#1269 review)", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "active_1",
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey: "other-key",
    });

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { idempotencyKey: "k1" } }),
    );
    // The active job is still the correct answer, but the caller's own key
    // was not stored on it — a later retry on that key would miss this row,
    // so this must not look like an unqualified success.
    expect(result).toEqual({
      job: expect.objectContaining({ id: "active_1" }),
      created: false,
      keyHonored: false,
    });
  });

  it("reports keyHonored: false when a concurrent attach loses the idempotencyKey race", async () => {
    findFirst.mockResolvedValueOnce({
      ...baseJob,
      id: "active_1",
      status: "RUNNING",
      startedAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey: null,
    });
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["courseId", "idempotencyKey"] },
    });
    update.mockRejectedValueOnce(conflict);

    const result = await startReEmbedJob("course_1", { idempotencyKey: "k1" });

    expect(result).toEqual({
      job: expect.objectContaining({ id: "active_1" }),
      created: false,
      keyHonored: false,
    });
  });
});
