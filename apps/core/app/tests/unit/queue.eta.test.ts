// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: { aiJob: { findMany } } }));

import {
  ETA_SAMPLE_SIZE,
  getQueueEtaSeconds,
} from "~/lib/queue/queue-eta.server";

const job = { queueName: "ai-jobs-chat", status: "PENDING" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getQueueEtaSeconds", () => {
  it("multiplies the live position by the recent pool mean", async () => {
    findMany.mockResolvedValue([
      {
        startedAt: new Date("2026-08-12T00:00:00.000Z"),
        completedAt: new Date("2026-08-12T00:01:00.000Z"),
      },
      {
        startedAt: new Date("2026-08-12T00:02:00.000Z"),
        completedAt: new Date("2026-08-12T00:03:30.000Z"),
      },
    ]);

    await expect(getQueueEtaSeconds(job, 2)).resolves.toBe(19);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        queueName: "ai-jobs-chat",
        status: "COMPLETED",
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { startedAt: true, completedAt: true },
      orderBy: { completedAt: "desc" },
      take: ETA_SAMPLE_SIZE,
    });
  });

  it("returns null before the pool has a usable completion sample", async () => {
    findMany.mockResolvedValue([
      { startedAt: null, completedAt: null },
      {
        startedAt: new Date("2026-08-12T00:02:00.000Z"),
        completedAt: new Date("2026-08-12T00:01:00.000Z"),
      },
    ]);

    await expect(getQueueEtaSeconds(job, 1)).resolves.toBeNull();
  });

  it("does not query for terminal jobs or missing queue positions", async () => {
    await expect(
      getQueueEtaSeconds({ ...job, status: "COMPLETED" }, null),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("degrades to null when the advisory stats query fails", async () => {
    findMany.mockRejectedValue(new Error("database unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await expect(getQueueEtaSeconds(job, 1)).resolves.toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });
});
