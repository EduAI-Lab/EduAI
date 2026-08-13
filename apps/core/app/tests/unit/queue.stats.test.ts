// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaMock = vi.hoisted(() => {
  const aiJob = { count: vi.fn() };
  return {
    aiJob,
    // getQueueSnapshot runs both reads on a transaction client; the mock hands
    // the callback this same client so the count assertions still apply.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ aiJob })),
  };
});

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getQueueDepth,
  getQueuePosition,
  getQueueSnapshot,
  maxQueueDepth,
  QueueFullError,
} from "~/lib/queue/queue-stats.server";
import { QUEUE_CHAT, QUEUE_HEAVY } from "~/lib/queue/resolve-pool.server";
import { resetFleetRegistryCache } from "~/lib/ai/routing/fleet/registry";

// resolveQueueName() (via heavyFleetConfigured()) reads fleet.config.json
// first, falling back to VLLM_FLEET_HEAVY_URL only when no config file is
// present. Without pointing FLEET_CONFIG_PATH at a file that doesn't exist,
// a real fleet.config.json on disk would silently override these tests'
// env-var-driven queue-fallback assertions below.
const NONEXISTENT_CONFIG_PATH = "./__no-such-fleet-config__.json";
const originalFleetConfigPath = process.env.FLEET_CONFIG_PATH;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  process.env.FLEET_CONFIG_PATH = NONEXISTENT_CONFIG_PATH;
  resetFleetRegistryCache();
  prismaMock.aiJob.count.mockResolvedValue(0);
});

afterEach(() => {
  if (originalFleetConfigPath === undefined) delete process.env.FLEET_CONFIG_PATH;
  else process.env.FLEET_CONFIG_PATH = originalFleetConfigPath;
  resetFleetRegistryCache();
});

// PENDING rows only count while plausibly in Redis: bullJobId persisted, or
// still inside the short window before a healthy enqueue writes it back.
// Keeps failed-add orphans from permanently eating QUEUE_MAX_DEPTH capacity.
const inTransport = {
  OR: [{ bullJobId: { not: null } }, { createdAt: { gt: expect.any(Date) } }],
};

describe("getQueueDepth", () => {
  it("counts PENDING in-transport rows pushed onto the queue", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(7);

    await expect(getQueueDepth(QUEUE_CHAT)).resolves.toBe(7);
    expect(prismaMock.aiJob.count).toHaveBeenCalledWith({
      where: { status: "PENDING", queueName: QUEUE_CHAT, ...inTransport },
    });
  });

  it("scopes the count to the requested queue, not the current type mapping", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(2);

    await expect(getQueueDepth(QUEUE_HEAVY)).resolves.toBe(2);
    expect(prismaMock.aiJob.count).toHaveBeenCalledWith({
      where: { status: "PENDING", queueName: QUEUE_HEAVY, ...inTransport },
    });
  });
});

describe("getQueuePosition", () => {
  const pendingBackground = {
    id: "aijob_1",
    type: "background" as const,
    status: "PENDING",
    createdAt: new Date("2026-07-20T00:00:00Z"),
    queueName: QUEUE_CHAT,
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
        queueName: QUEUE_CHAT,
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
        queueName: QUEUE_CHAT,
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

  it("stays on the row's persisted queue even after the heavy pool is turned on", async () => {
    // The row was pushed onto ai-jobs:chat; flipping VLLM_FLEET_HEAVY_URL now
    // routes new background jobs to ai-jobs:heavy but must not silently move
    // this one — position is read against the queue it actually sits in.
    vi.stubEnv("VLLM_FLEET_HEAVY_URL", "http://cmps03:8000");

    await getQueuePosition(pendingBackground);

    expect(prismaMock.aiJob.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ queueName: QUEUE_CHAT }) }),
    );
  });

  it("falls back to the current type mapping for a row with no persisted queueName", async () => {
    await getQueuePosition({ ...pendingBackground, queueName: null });

    expect(prismaMock.aiJob.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ queueName: QUEUE_CHAT }) }),
    );
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

describe("getQueueSnapshot", () => {
  const pendingBackground = {
    id: "aijob_1",
    type: "background" as const,
    status: "PENDING",
    createdAt: new Date("2026-07-20T00:00:00Z"),
    queueName: QUEUE_CHAT,
  };

  it("reads position and depth under one REPEATABLE READ transaction", async () => {
    prismaMock.aiJob.count.mockResolvedValueOnce(2).mockResolvedValueOnce(9);

    await expect(getQueueSnapshot(pendingBackground, QUEUE_CHAT)).resolves.toEqual({
      queuePosition: 3,
      queueDepth: 9,
    });

    // The isolation level is the fix, not decoration: under the READ COMMITTED
    // default each statement takes a fresh snapshot even inside a transaction,
    // so jobs draining between the two counts could still push position past
    // depth. Assert it explicitly so a future refactor can't quietly drop it.
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
  });

  it("pins one grace-window cutoff across both reads", async () => {
    // The clock has to move between the two reads for this to prove anything —
    // with a real clock both `new Date()` calls land in the same millisecond and
    // the test passes even when the cutoff is not shared.
    vi.useFakeTimers();
    prismaMock.aiJob.count.mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return 0;
    });

    try {
      await getQueueSnapshot(pendingBackground, QUEUE_CHAT);
    } finally {
      vi.useRealTimers();
    }

    // Two `Date.now()` values would age the same orphan differently between the
    // two queries — a second way the pair could disagree.
    const cutoffs = prismaMock.aiJob.count.mock.calls.map((call) => {
      const where = call[0].where as {
        OR?: Array<{ createdAt?: { gt?: Date } }>;
        AND?: Array<{ OR?: Array<{ createdAt?: { gt?: Date } }> }>;
      };
      const transport = where.OR ?? where.AND?.[0]?.OR;
      return transport?.find((clause) => clause.createdAt?.gt)?.createdAt?.gt?.getTime();
    });
    expect(cutoffs).toHaveLength(2);
    expect(cutoffs[0]).toBe(cutoffs[1]);
  });

  it("still returns a null position for a job that is no longer PENDING", async () => {
    prismaMock.aiJob.count.mockResolvedValue(4);

    await expect(
      getQueueSnapshot({ ...pendingBackground, status: "RUNNING" }, QUEUE_CHAT),
    ).resolves.toEqual({ queuePosition: null, queueDepth: 4 });
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
    expect(error.message).toContain(QUEUE_CHAT);
  });
});
