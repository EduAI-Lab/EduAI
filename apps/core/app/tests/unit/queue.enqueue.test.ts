// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { JobPayload } from "~/lib/queue/job-schema";

const prismaMock = vi.hoisted(() => {
  const aiJob = {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  return {
    aiJob,
    // The post-enqueue snapshot reads position + depth inside one REPEATABLE
    // READ transaction; the mock runs that callback against the same client.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ aiJob })),
  };
});

const queueAdd = vi.hoisted(() => vi.fn());
const getQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAdd })));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/queue/queues.server", () => ({ getQueue: getQueueMock }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import { enqueue } from "~/lib/queue/enqueue.server";
import { QueueFullError } from "~/lib/queue/queue-stats.server";

const job: JobPayload = {
  kind: "question-generation",
  type: "background",
  source: "question-maker",
  userId: "user_1",
  courseId: "course_1",
  input: { kind: "question-generation", courseId: "course_1", prompt: "5 qs", count: 5 },
};

/**
 * Both stats reads go through `prisma.aiJob.count`, so the two have to be told
 * apart by query shape rather than call order — only the position read excludes
 * a specific row (`id: { not: job.id }`). Routing on shape lets each test state
 * "N jobs ahead, M in the queue" independently, so a regression that swaps the
 * queries or drops this job from the depth count actually fails an assertion.
 */
function stubCounts({ ahead, depth }: { ahead: number; depth: number }) {
  prismaMock.aiJob.count.mockImplementation((args: { where?: { id?: unknown } }) =>
    Promise.resolve(args?.where?.id === undefined ? depth : ahead),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMock.aiJob.create.mockResolvedValue({
    id: "aijob_1",
    type: "background",
    status: "PENDING",
    createdAt: new Date("2026-07-20T00:00:00Z"),
  });
  prismaMock.aiJob.update.mockResolvedValue({});
  prismaMock.aiJob.findUnique.mockResolvedValue(null);
  prismaMock.aiJob.delete.mockResolvedValue({});
  // Default: this job is alone in the queue — nothing ahead of it, and the depth
  // count includes it. `{ ahead: 0, depth: 0 }` would be an impossible snapshot.
  stubCounts({ ahead: 0, depth: 1 });
  queueAdd.mockResolvedValue({ id: "bull_1" });
});

describe("enqueue", () => {
  it("creates a PENDING AiJob, enqueues, persists bullJobId, and returns the DB id", async () => {
    const result = await enqueue(job);

    // Position/depth are live snapshots (#915): nothing ahead of this job, so
    // it's next up, and the depth count includes it — depth is never below
    // position for a job that just landed.
    expect(result).toEqual({ jobId: "aijob_1", queuePosition: 1, queueDepth: 1 });

    expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          kind: "question-generation",
          source: "question-maker",
          queueName: "ai-jobs:chat",
        }),
      }),
    );
    // background → chat pool (heavy pool unset in v1), low priority (10), BullMQ name = kind.
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs:chat");
    expect(queueAdd).toHaveBeenCalledWith("question-generation", job, { jobId: undefined, priority: 10 });
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: { bullJobId: "bull_1" },
    });
  });

  it("enqueues interactive work at high priority", async () => {
    await enqueue({ ...job, type: "interactive" });
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs:chat");
    expect(queueAdd).toHaveBeenCalledWith("question-generation", expect.anything(), expect.objectContaining({ priority: 1 }));
  });

  it("passes idempotencyKey through as the BullMQ jobId", async () => {
    await enqueue({ ...job, idempotencyKey: "idem-9" });
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { queueName_bullJobId: { queueName: "ai-jobs:chat", bullJobId: "idem-9" } },
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "question-generation",
      expect.anything(),
      expect.objectContaining({ jobId: "idem-9" }),
    );
  });

  it("returns the existing row for a repeated idempotencyKey without creating a new one", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_existing",
      type: "background",
      status: "PENDING",
      createdAt: new Date("2026-07-19T00:00:00Z"),
    });

    // Replay stats come from the existing row: 2 ahead of it, 5 in the queue.
    stubCounts({ ahead: 2, depth: 5 });

    const result = await enqueue({ ...job, idempotencyKey: "idem-9" });

    expect(result).toEqual({ jobId: "aijob_existing", queuePosition: 3, queueDepth: 5 });
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("rejects with QueueFullError when QUEUE_MAX_DEPTH is reached, before writing anything", async () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "2");
    stubCounts({ ahead: 0, depth: 2 }); // depth check sees a full queue

    await expect(enqueue(job)).rejects.toBeInstanceOf(QueueFullError);
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("enqueues when depth is below QUEUE_MAX_DEPTH", async () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "2");
    stubCounts({ ahead: 0, depth: 1 }); // depth check passes

    const result = await enqueue(job);
    expect(result.jobId).toBe("aijob_1");
    expect(prismaMock.aiJob.create).toHaveBeenCalled();
  });

  it("reports depth from a post-write read, never the pre-write backpressure count", async () => {
    // The cap's count is taken before the row exists. Deriving depth from it
    // (`count + 1`) while position is read fresh can report position > depth,
    // an impossible snapshot — so depth must come from its own later read.
    vi.stubEnv("QUEUE_MAX_DEPTH", "100");
    stubCounts({ ahead: 6, depth: 12 });

    const result = await enqueue(job);

    expect(result).toEqual({ jobId: "aijob_1", queuePosition: 7, queueDepth: 12 });
    expect(result.queueDepth!).toBeGreaterThanOrEqual(result.queuePosition!);
  });

  it("never applies backpressure when QUEUE_MAX_DEPTH is unset", async () => {
    stubCounts({ ahead: 9999, depth: 9999 });

    const result = await enqueue(job);
    expect(result.jobId).toBe("aijob_1");
  });

  it("never rejects an idempotent replay even when the queue is full", async () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "1");
    stubCounts({ ahead: 50, depth: 50 });
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_existing",
      type: "background",
      status: "PENDING",
      createdAt: new Date("2026-07-19T00:00:00Z"),
    });

    const result = await enqueue({ ...job, idempotencyKey: "idem-9" });
    expect(result.jobId).toBe("aijob_existing");
  });

  it("rejects an invalid payload before touching the DB", async () => {
    await expect(enqueue({ ...job, kind: "nope" } as unknown as JobPayload)).rejects.toThrow();
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
  });

  it("throws and leaves an unkeyed row without bullJobId when the queue add fails", async () => {
    queueAdd.mockRejectedValueOnce(new Error("redis down"));
    await expect(enqueue(job)).rejects.toThrow("redis down");
    expect(prismaMock.aiJob.create).toHaveBeenCalled();
    expect(prismaMock.aiJob.update).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.delete).not.toHaveBeenCalled(); // kept for the reaper
  });

  it("deletes the keyed row when the queue add fails so the replay isn't blocked", async () => {
    queueAdd.mockRejectedValueOnce(new Error("redis down"));
    await expect(enqueue({ ...job, idempotencyKey: "idem-9" })).rejects.toThrow("redis down");
    // Fast path looks up by bullJobId (= the key), never persisted here — an
    // orphan would be invisible to the retry and duplicate the logical job.
    expect(prismaMock.aiJob.delete).toHaveBeenCalledWith({ where: { id: "aijob_1" } });
  });

  it("returns null stats instead of failing when the post-enqueue stats read throws", async () => {
    prismaMock.aiJob.count.mockRejectedValue(new Error("db blip"));

    const result = await enqueue(job);

    // Job is durably enqueued at this point — a 5xx here would trigger a
    // duplicate-producing retry, so stats degrade to null instead.
    expect(result).toEqual({ jobId: "aijob_1", queuePosition: null, queueDepth: null });
    expect(queueAdd).toHaveBeenCalled();
  });

  it("scopes the row and its lookups to the resolved queue when the heavy pool is configured", async () => {
    vi.stubEnv("VLLM_FLEET_HEAVY_URL", "http://cmps03:8000");
    try {
      await enqueue({ ...job, idempotencyKey: "idem-9" });

      // background + heavy pool configured → ai-jobs:heavy, and the dedupe lookup
      // must be keyed on that queue: a chat job may legitimately share bullJobId "1".
      expect(getQueueMock).toHaveBeenCalledWith("ai-jobs:heavy");
      expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { queueName_bullJobId: { queueName: "ai-jobs:heavy", bullJobId: "idem-9" } },
        }),
      );
      expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ queueName: "ai-jobs:heavy" }) }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns the winning row on a same-queue bullJobId race and drops its own", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["queueName", "bullJobId"] },
    });
    prismaMock.aiJob.update.mockRejectedValueOnce(conflict);
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_winner",
      type: "background",
      status: "PENDING",
      createdAt: new Date("2026-07-20T00:00:00Z"),
      queueName: "ai-jobs:chat",
    });
    // 2 ahead of the winner → 1-based position 3; depth is a separate count.
    stubCounts({ ahead: 2, depth: 9 });

    const result = await enqueue(job);

    // The loser's row is dropped, and the snapshot describes the winner (#915).
    expect(result).toEqual({ jobId: "aijob_winner", queuePosition: 3, queueDepth: 9 });
    expect(prismaMock.aiJob.delete).toHaveBeenCalledWith({ where: { id: "aijob_1" } });
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { queueName_bullJobId: { queueName: "ai-jobs:chat", bullJobId: "bull_1" } },
      }),
    );
  });
});
