// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { JobPayload } from "~/lib/queue/job-schema";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

const PrismaClientKnownRequestErrorMock = vi.hoisted(
  () =>
    class PrismaClientKnownRequestError extends Error {
      code: string;
      meta?: Record<string, unknown>;

      constructor(
        message: string,
        options: {
          code: string;
          clientVersion?: string;
          meta?: Record<string, unknown>;
        },
      ) {
        super(message);
        this.code = options.code;
        this.meta = options.meta;
      }
    },
);

const prismaMock = vi.hoisted(() => {
  const aiJob = {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
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

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: PrismaClientKnownRequestErrorMock,
    // Unused by these tests but referenced by isInfrastructureError's
    // instanceof checks — a bare `undefined` there throws a TypeError.
    PrismaClientInitializationError: class PrismaClientInitializationError extends Error {},
    PrismaClientRustPanicError: class PrismaClientRustPanicError extends Error {},
  },
}));
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

const infraError = () =>
  new Prisma.PrismaClientKnownRequestError("operations timed out", {
    code: "P1008",
    clientVersion: "6",
  });

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
  prismaMock.aiJob.deleteMany.mockResolvedValue({ count: 1 });
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
          queueName: "ai-jobs-chat",
        }),
      }),
    );
    // background → chat pool (heavy pool unset in v1), low priority (10), BullMQ name = kind.
    // aiJobId is embedded in the payload so a worker can always find this row
    // (#1112 review), independent of the bullJobId persist below.
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs-chat");
    expect(queueAdd).toHaveBeenCalledWith(
      "question-generation",
      { ...job, aiJobId: "aijob_1" },
      {
        jobId: undefined,
        priority: 10,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: { bullJobId: "bull_1" },
    });
  });

  it("enqueues interactive work at high priority", async () => {
    await enqueue({ ...job, type: "interactive" });
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs-chat");
    expect(queueAdd).toHaveBeenCalledWith("question-generation", expect.anything(), expect.objectContaining({ priority: 1 }));
  });

  it("passes idempotencyKey through as the BullMQ jobId", async () => {
    await enqueue({ ...job, idempotencyKey: "idem-9" });
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { queueName_bullJobId: { queueName: "ai-jobs-chat", bullJobId: "idem-9" } },
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "question-generation",
      expect.objectContaining({
        idempotencyKey: "idem-9",
        aiJobId: "aijob_1",
      }),
      expect.objectContaining({ jobId: "idem-9" }),
    );
  });

  it("configures the BullMQ retry policy from worker env", async () => {
    vi.stubEnv("AI_JOB_ATTEMPTS", "5");
    vi.stubEnv("AI_JOB_RETRY_DELAY_MS", "750");
    try {
      await enqueue(job);
      expect(queueAdd).toHaveBeenCalledWith(
        "question-generation",
        expect.anything(),
        expect.objectContaining({
          attempts: 5,
          backoff: { type: "exponential", delay: 750 },
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("surfaces 503 when the idempotency lookup hits an infra failure", async () => {
    prismaMock.aiJob.findUnique.mockRejectedValueOnce(infraError());
    await expect(enqueue({ ...job, idempotencyKey: "idem-9" })).rejects.toBeInstanceOf(
      QueueUnavailableError,
    );
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
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

  it("surfaces 503 when creating the AiJob row hits an infra failure", async () => {
    prismaMock.aiJob.create.mockRejectedValueOnce(infraError());
    await expect(enqueue(job)).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("marks an unkeyed row FAILED (not deleted) when the queue add fails (#1269 review)", async () => {
    queueAdd.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueue(job)).rejects.toThrow("boom");
    expect(prismaMock.aiJob.create).toHaveBeenCalled();
    expect(prismaMock.aiJob.delete).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("marks the keyed row FAILED (not deleted) when the queue add fails, so a same-key retry finds it (#1269 review)", async () => {
    queueAdd.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueue({ ...job, idempotencyKey: "idem-9" })).rejects.toThrow("boom");
    // A deleted keyed row would let a same-key retry mint a second AiJob row
    // while queue.add() with the same jobId silently no-ops in Redis if the
    // original add actually succeeded — leaving the retry's row stuck PENDING.
    expect(prismaMock.aiJob.delete).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("surfaces 503 (still marking the row FAILED) when the queue add fails with an infra-classified error", async () => {
    queueAdd.mockRejectedValueOnce(infraError());
    await expect(enqueue(job)).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
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

      // background + heavy pool configured → ai-jobs-heavy, and the dedupe lookup
      // must be keyed on that queue: a chat job may legitimately share bullJobId "1".
      expect(getQueueMock).toHaveBeenCalledWith("ai-jobs-heavy");
      expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { queueName_bullJobId: { queueName: "ai-jobs-heavy", bullJobId: "idem-9" } },
        }),
      );
      expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ queueName: "ai-jobs-heavy" }) }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns the winning row on a create-time bullJobId race without ever calling queue.add (#1269 review)", async () => {
    // A keyed job's bullJobId is set at create time now (#1269 review), so
    // two concurrent enqueues on the same key race at create(), not at the
    // old post-add persist — and the loser never reaches Redis at all.
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["queueName", "bullJobId"] },
    });
    prismaMock.aiJob.create.mockRejectedValueOnce(conflict);
    // First findUnique call is step 3's idempotency lookup (must miss, or
    // this short-circuits before ever reaching create()); the second is the
    // winner lookup in create()'s conflict handler.
    prismaMock.aiJob.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "aijob_winner",
      type: "background",
      status: "PENDING",
      createdAt: new Date("2026-07-19T00:00:00Z"),
    });
    // 2 ahead of the winner → 1-based position 3; depth is a separate count.
    stubCounts({ ahead: 2, depth: 9 });

    const result = await enqueue({ ...job, idempotencyKey: "idem-9" });

    expect(result).toEqual({ jobId: "aijob_winner", queuePosition: 3, queueDepth: 9 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { queueName_bullJobId: { queueName: "ai-jobs-chat", bullJobId: "idem-9" } },
      }),
    );
  });

  it("surfaces the original conflict when the create-time race's winner row can no longer be found", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
      meta: { target: ["queueName", "bullJobId"] },
    });
    prismaMock.aiJob.create.mockRejectedValueOnce(conflict);
    // Both findUnique calls (step 3's lookup, then the conflict handler's
    // winner lookup) miss — the default mock already resolves null, no
    // override needed.

    await expect(enqueue({ ...job, idempotencyKey: "idem-9" })).rejects.toStrictEqual(conflict);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("does not persist bullJobId again after queue.add for a keyed job (#1269 review)", async () => {
    // bullJobId already equals the idempotencyKey from create time, and
    // queue.add({ jobId: idempotencyKey }) always echoes that same id back —
    // nothing left to persist, and no (queueName, bullJobId) conflict is
    // possible here the way it was for the old post-add persist.
    queueAdd.mockResolvedValueOnce({ id: "idem-9" });

    await enqueue({ ...job, idempotencyKey: "idem-9" });

    expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bullJobId: "idem-9" }) }),
    );
    expect(prismaMock.aiJob.update).not.toHaveBeenCalled();
  });

  it("a same-key retry after queue.add fails finds the FAILED row instead of creating a duplicate (#1269 review)", async () => {
    // First attempt: queue.add fails, row is marked FAILED but already
    // carries bullJobId from create time.
    queueAdd.mockRejectedValueOnce(new Error("boom"));
    await expect(enqueue({ ...job, idempotencyKey: "idem-9" })).rejects.toThrow("boom");
    expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(1);

    // Retry with the same key: step 3's lookup now finds that same FAILED
    // row (bullJobId was persisted at create time, not lost with the row's
    // never-run post-add persist) and returns it without a second create().
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      type: "background",
      status: "FAILED",
      createdAt: new Date("2026-07-20T00:00:00Z"),
    });

    const result = await enqueue({ ...job, idempotencyKey: "idem-9" });

    expect(result.jobId).toBe("aijob_1");
    expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(1);
  });

  it("surfaces 503 without marking the row FAILED when the post-add bullJobId persist hits a non-conflict infra failure", async () => {
    // The job is already durably queued (found via embedded aiJobId) — only a
    // future idempotency lookup by bullJobId would miss it, so this must not
    // mark the row FAILED and lose a job a worker is about to run (#1269 review).
    prismaMock.aiJob.update.mockRejectedValueOnce(infraError());
    await expect(enqueue(job)).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(prismaMock.aiJob.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.aiJob.delete).not.toHaveBeenCalled();
  });
});
