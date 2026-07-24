// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aiJob: { count: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getQueueDepth,
  getQueuePosition,
  maxQueueDepth,
  QueueFullError,
  typesForQueue,
} from "~/lib/queue/queue-stats.server";
import { QUEUE_CHAT, QUEUE_HEAVY } from "~/lib/queue/resolve-pool.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMock.aiJob.count.mockResolvedValue(0);
});

describe("typesForQueue", () => {
  it("maps both types to the chat queue while the heavy pool is off (v1 reality)", () => {
    expect(typesForQueue(QUEUE_CHAT)).toEqual(["interactive", "background"]);
    expect(typesForQueue(QUEUE_HEAVY)).toEqual([]);
  });

  it("splits background off to the heavy queue once the heavy pool is configured", () => {
    vi.stubEnv("VLLM_FLEET_HEAVY_URL", "http://cmps03:8000");
    expect(typesForQueue(QUEUE_CHAT)).toEqual(["interactive"]);
    expect(typesForQueue(QUEUE_HEAVY)).toEqual(["background"]);
  });
});

// PENDING rows only count while plausibly in Redis: bullJobId persisted, or
// still inside the short window before a healthy enqueue writes it back.
// Keeps failed-add orphans from permanently eating QUEUE_MAX_DEPTH capacity.
const inTransport = {
  OR: [{ bullJobId: { not: null } }, { createdAt: { gt: expect.any(Date) } }],
};

describe("getQueueDepth", () => {
  it("counts PENDING in-transport rows whose type resolves to the queue", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(7);

    await expect(getQueueDepth(QUEUE_CHAT)).resolves.toBe(7);
    expect(prismaMock.aiJob.count).toHaveBeenCalledWith({
      where: { status: "PENDING", type: { in: ["interactive", "background"] }, ...inTransport },
    });
  });

  it("returns 0 without querying when no type resolves to the queue", async () => {
    await expect(getQueueDepth(QUEUE_HEAVY)).resolves.toBe(0);
    expect(prismaMock.aiJob.count).not.toHaveBeenCalled();
  });
});

describe("getQueuePosition", () => {
  const pendingBackground = {
    id: "aijob_1",
    type: "background" as const,
    status: "PENDING",
    createdAt: new Date("2026-07-20T00:00:00Z"),
  };

  it("returns null for a job that is no longer PENDING, without querying", async () => {
    await expect(getQueuePosition({ ...pendingBackground, status: "RUNNING" })).resolves.toBeNull();
    expect(prismaMock.aiJob.count).not.toHaveBeenCalled();
  });

  it("counts stronger-priority jobs and earlier same-priority jobs as ahead (background)", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(3);

    await expect(getQueuePosition(pendingBackground)).resolves.toBe(4); // 3 ahead → 1-based 4

    // Shared chat queue: every PENDING interactive job (priority 1 < 10) is
    // ahead, plus background jobs created earlier (id tiebreak on identical
    // createdAt so two same-millisecond jobs never share a position).
    expect(prismaMock.aiJob.count).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        id: { not: "aijob_1" },
        AND: [
          inTransport,
          {
            OR: [
              { type: { in: ["interactive"] } },
              {
                type: { in: ["background"] },
                OR: [
                  { createdAt: { lt: pendingBackground.createdAt } },
                  { createdAt: pendingBackground.createdAt, id: { lt: "aijob_1" } },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("only counts earlier interactive jobs for an interactive job (nothing outranks it)", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(0);

    await expect(
      getQueuePosition({ ...pendingBackground, type: "interactive" }),
    ).resolves.toBe(1);

    expect(prismaMock.aiJob.count).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        id: { not: "aijob_1" },
        AND: [
          inTransport,
          {
            OR: [
              {
                type: { in: ["interactive"] },
                OR: [
                  { createdAt: { lt: pendingBackground.createdAt } },
                  { createdAt: pendingBackground.createdAt, id: { lt: "aijob_1" } },
                ],
              },
            ],
          },
        ],
      },
    });
  });
});

describe("maxQueueDepth", () => {
  it("is disabled (null) when QUEUE_MAX_DEPTH is unset, blank, zero, or junk", () => {
    expect(maxQueueDepth()).toBeNull();
    vi.stubEnv("QUEUE_MAX_DEPTH", "   ");
    expect(maxQueueDepth()).toBeNull();
    vi.stubEnv("QUEUE_MAX_DEPTH", "0");
    expect(maxQueueDepth()).toBeNull();
    vi.stubEnv("QUEUE_MAX_DEPTH", "not-a-number");
    expect(maxQueueDepth()).toBeNull();
  });

  it("rejects partial-numeric values instead of truncating them (1e3 must not become 1)", () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "1e3");
    expect(maxQueueDepth()).toBeNull();
    vi.stubEnv("QUEUE_MAX_DEPTH", "10k");
    expect(maxQueueDepth()).toBeNull();
    vi.stubEnv("QUEUE_MAX_DEPTH", "-5");
    expect(maxQueueDepth()).toBeNull();
  });

  it("parses a positive integer cap", () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "25");
    expect(maxQueueDepth()).toBe(25);
  });
});

describe("QueueFullError", () => {
  it("carries the queue, depth, cap, and a Retry-After hint", () => {
    const error = new QueueFullError(QUEUE_CHAT, 25, 25);
    expect(error.name).toBe("QueueFullError");
    expect(error.queueName).toBe(QUEUE_CHAT);
    expect(error.depth).toBe(25);
    expect(error.maxDepth).toBe(25);
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.message).toContain("ai-jobs:chat");
  });
});
