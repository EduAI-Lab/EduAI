// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type {
  JobPayload,
  QueuedJobPayload,
} from "~/lib/queue/job-schema";

const prismaMock = vi.hoisted(() => ({
  aiJob: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));
const queueAdd = vi.hoisted(() => vi.fn());
const getQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAdd })));
const runCompletionMock = vi.hoisted(() => vi.fn());
const persistAiInteractionTelemetryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
}));
vi.mock("~/lib/queue/queues.server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/lib/queue/queues.server")>();
  return {
    ...original,
    getQueue: getQueueMock,
  };
});
vi.mock("~/lib/ai/completion.server", () => ({
  runCompletion: runCompletionMock,
}));
vi.mock("~/lib/ai/routing/telemetry.server", () => ({
  persistAiInteractionTelemetry: persistAiInteractionTelemetryMock,
}));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn().mockResolvedValue(undefined),
}));

import { enqueue } from "~/lib/queue/enqueue.server";
import {
  aiJobTimeoutMs,
  executeAiJobPayload,
  processAiJob,
  workerConcurrency,
} from "~/lib/queue/worker.server";
import { AI_JOB_QUEUE_NAMES } from "~/lib/queue/queues.server";

const payload: JobPayload = {
  kind: "question-generation",
  type: "background",
  source: "question-maker",
  userId: "user_1",
  courseId: "course_1",
  input: {
    kind: "question-generation",
    courseId: "course_1",
    prompt: "Generate questions about binary search",
    count: 5,
  },
  requestedModel: "vllm:qwen2.5-32b-instruct",
};

function bullJob(
  data: JobPayload | QueuedJobPayload = payload,
  overrides: Partial<Job<JobPayload | QueuedJobPayload>> = {},
): Job<JobPayload | QueuedJobPayload> {
  return {
    id: "bull_1",
    name: data.kind,
    data,
    attemptsMade: 0,
    opts: {},
    ...overrides,
  } as Job<JobPayload | QueuedJobPayload>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMock.aiJob.create.mockResolvedValue({ id: "aijob_1" });
  prismaMock.aiJob.update.mockResolvedValue({});
  prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.aiJob.delete.mockResolvedValue({});
  queueAdd.mockResolvedValue({ id: "bull_1" });
  persistAiInteractionTelemetryMock.mockResolvedValue(undefined);
});

describe("AI-job dequeue worker", () => {
  it("uses the durable id when dequeue wins the bullJobId persistence race", async () => {
    let emittedPayload: QueuedJobPayload | undefined;
    queueAdd.mockImplementation(
      async (_name: string, data: QueuedJobPayload) => {
        emittedPayload = data;
        return { id: "bull_1" };
      },
    );

    await expect(enqueue(payload)).resolves.toEqual({
      jobId: "aijob_1",
      queuePosition: null,
      queueDepth: null,
    });
    expect(emittedPayload).toEqual({
      ...payload,
      aiJobId: "aijob_1",
    });

    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "PENDING",
      startedAt: null,
      userId: "user_1",
      queueName: "ai-jobs-chat",
      bullJobId: null,
    });
    const execute = vi.fn().mockResolvedValue({
      kind: "question-generation",
      model: "vllm:qwen2.5-32b-instruct",
      output: { content: "[]", requestedCount: 5 },
      fleetHost: "http://cmps03:8001",
    });

    const result = await processAiJob(
      bullJob(emittedPayload),
      "ai-jobs-chat",
      execute,
    );

    expect(execute).toHaveBeenCalledWith(payload);
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        userId: true,
        queueName: true,
        bullJobId: true,
      },
    });
    expect(prismaMock.aiJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "aijob_1",
          status: "PENDING",
        },
        data: expect.objectContaining({
          status: "RUNNING",
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(prismaMock.aiJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "aijob_1", status: "RUNNING" },
        data: expect.objectContaining({
          status: "COMPLETED",
          result,
          errorMessage: null,
        }),
      }),
    );
  });

  it("falls back to the queue identity when the embedded row lost an idempotency race", async () => {
    prismaMock.aiJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "aijob_winner",
        status: "PENDING",
        startedAt: null,
        userId: "user_1",
        queueName: "ai-jobs-chat",
        bullJobId: "dedupe-key",
      });
    const execute = vi.fn().mockResolvedValue({
      kind: "question-generation",
      model: "vllm:qwen2.5-32b-instruct",
      output: { content: "[]", requestedCount: 5 },
    });

    await expect(
      processAiJob(
        bullJob(
          { ...payload, idempotencyKey: "dedupe-key", aiJobId: "deleted-row" },
          { id: "dedupe-key" },
        ),
        "ai-jobs-chat",
        execute,
      ),
    ).resolves.toEqual(expect.objectContaining({ kind: "question-generation" }));

    expect(prismaMock.aiJob.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        queueName_bullJobId: {
          queueName: "ai-jobs-chat",
          bullJobId: "dedupe-key",
        },
      },
      select: expect.any(Object),
    });
    expect(prismaMock.aiJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "aijob_winner", status: "PENDING" },
      }),
    );
  });

  it("rejects a duplicate delivery while the durable row is already running", async () => {
    prismaMock.aiJob.findUnique
      .mockResolvedValueOnce({
        id: "aijob_1",
        status: "RUNNING",
        startedAt: new Date("2026-07-29T00:00:00Z"),
        userId: "user_1",
        queueName: "ai-jobs-chat",
        bullJobId: "bull_1",
      })
      .mockResolvedValueOnce({ status: "RUNNING" });
    prismaMock.aiJob.updateMany.mockResolvedValueOnce({ count: 0 });
    const execute = vi.fn();

    await expect(
      processAiJob(bullJob(), "ai-jobs-chat", execute),
    ).rejects.toThrow("Could not claim AiJob aijob_1");
    expect(execute).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aijob_1", status: "PENDING" },
      }),
    );
  });

  it("leaves a cancelled row terminal and skips inference", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "CANCELLED",
      startedAt: null,
      userId: "user_1",
      queueName: "ai-jobs-chat",
      bullJobId: "bull_1",
    });
    const execute = vi.fn();

    await expect(
      processAiJob(bullJob(), "ai-jobs-chat", execute),
    ).resolves.toEqual({ skipped: true, reason: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.updateMany).not.toHaveBeenCalled();
  });

  it("returns a transient failure to PENDING so BullMQ can retry", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "PENDING",
      startedAt: null,
      userId: "user_1",
      queueName: "ai-jobs-chat",
      bullJobId: "bull_1",
    });
    const execute = vi.fn().mockRejectedValue(new Error("temporary outage"));

    await expect(
      processAiJob(
        bullJob(payload, { attemptsMade: 0, opts: { attempts: 3 } }),
        "ai-jobs-chat",
        execute,
      ),
    ).rejects.toThrow("temporary outage");

    expect(prismaMock.aiJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "aijob_1", status: "RUNNING" },
      data: {
        status: "PENDING",
        errorMessage: "temporary outage",
        completedAt: null,
      },
    });
  });

  it("marks the row FAILED only after the final BullMQ attempt", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "PENDING",
      startedAt: new Date("2026-07-27T00:00:00Z"),
      userId: "user_1",
      queueName: "ai-jobs-heavy",
      bullJobId: "bull_1",
    });
    const execute = vi.fn().mockRejectedValue(new Error("permanent outage"));

    await expect(
      processAiJob(
        bullJob(payload, { attemptsMade: 2, opts: { attempts: 3 } }),
        "ai-jobs-heavy",
        execute,
      ),
    ).rejects.toThrow("permanent outage");

    expect(prismaMock.aiJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: "aijob_1", status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: "permanent outage",
        completedAt: expect.any(Date),
      },
    });
  });

  it("rejects a BullMQ name that does not match the validated payload kind", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "PENDING",
      startedAt: null,
      userId: "user_1",
      queueName: "ai-jobs-chat",
      bullJobId: "bull_1",
    });

    await expect(
      processAiJob(
        bullJob(payload, { name: "wrong-kind" }),
        "ai-jobs-chat",
        vi.fn(),
      ),
    ).rejects.toThrow('does not match payload kind "question-generation"');
  });
});

describe("AI-job execution", () => {
  it("registers a worker queue for each fleet pool", () => {
    expect(AI_JOB_QUEUE_NAMES).toEqual(["ai-jobs-chat", "ai-jobs-heavy"]);
  });

  it("runs question generation through the fleet-aware completion seam", async () => {
    runCompletionMock.mockResolvedValue({
      ok: true,
      streaming: false,
      body: {
        content: '[{"question":"What is binary search?"}]',
        model: "vllm:qwen2.5-32b-instruct",
        usage: { inputTokens: 12, outputTokens: 20 },
        finishReason: "stop",
      },
      internal: {
        fleetHost: "http://cmps03:8001",
        fleetServerId: "cmps03",
      },
    });

    await expect(executeAiJobPayload(payload)).resolves.toEqual({
      kind: "question-generation",
      model: "vllm:qwen2.5-32b-instruct",
      output: {
        content: '[{"question":"What is binary search?"}]',
        requestedCount: 5,
      },
      usage: { inputTokens: 12, outputTokens: 20 },
      fleetHost: "http://cmps03:8001",
      fleetServerId: "cmps03",
    });
    expect(runCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "vllm:qwen2.5-32b-instruct",
        apiKeys: {},
        streaming: false,
        routingContext: { jobType: "background" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  // Async Question Maker jobs (this seam) previously never wrote an
  // AIInteraction row at all, so a completed job never showed up in the
  // admin Servers tab's per-server/per-model totals — those totals only
  // ever queried AIInteraction. This mirrors chat.ts's persistTurnTelemetry
  // call so worker-executed completions become visible the same way.
  it("persists AIInteraction telemetry for the fleet server that served the job", async () => {
    runCompletionMock.mockResolvedValue({
      ok: true,
      streaming: false,
      body: {
        content: '[{"question":"What is binary search?"}]',
        model: "vllm:qwen2.5-32b-instruct",
        usage: { inputTokens: 12, outputTokens: 20 },
        finishReason: "stop",
      },
      internal: {
        fleetHost: "http://cmps03:8001",
        fleetServerId: "cmps03",
      },
    });

    await executeAiJobPayload(payload);

    expect(persistAiInteractionTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        courseId: "course_1",
        resolvedModelId: "vllm:qwen2.5-32b-instruct",
        query: "Generate questions about binary search",
        responseText: '[{"question":"What is binary search?"}]',
        usage: { inputTokens: 12, outputTokens: 20 },
        finishReason: "stop",
        durationMs: expect.any(Number),
        serverId: "cmps03",
      }),
    );
  });

  it("persists a null serverId when the completion was not fleet-routed", async () => {
    runCompletionMock.mockResolvedValue({
      ok: true,
      streaming: false,
      body: {
        content: "[]",
        model: "openai:gpt-4o",
        usage: { inputTokens: 5, outputTokens: 5 },
        finishReason: "stop",
      },
      internal: { fleetHost: null, fleetServerId: null },
    });

    await executeAiJobPayload(payload);

    expect(persistAiInteractionTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: null }),
    );
  });

  it("does not let a telemetry write failure fail the job itself", async () => {
    runCompletionMock.mockResolvedValue({
      ok: true,
      streaming: false,
      body: {
        content: "[]",
        model: "vllm:qwen2.5-32b-instruct",
        usage: { inputTokens: 5, outputTokens: 5 },
        finishReason: "stop",
      },
      internal: { fleetHost: "http://cmps03:8001", fleetServerId: "cmps03" },
    });
    persistAiInteractionTelemetryMock.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(executeAiJobPayload(payload)).resolves.toEqual(
      expect.objectContaining({ kind: "question-generation" }),
    );
  });

  it("uses independently configurable chat and heavy concurrency", () => {
    vi.stubEnv("AI_JOB_CHAT_CONCURRENCY", "12");
    vi.stubEnv("AI_JOB_HEAVY_CONCURRENCY", "2");
    expect(workerConcurrency("ai-jobs-chat")).toBe(12);
    expect(workerConcurrency("ai-jobs-heavy")).toBe(2);
  });

  it("uses an independently configurable provider execution timeout", () => {
    vi.stubEnv("AI_JOB_EXECUTION_TIMEOUT_MS", "4321");
    expect(aiJobTimeoutMs()).toBe(4321);

    vi.stubEnv("AI_JOB_EXECUTION_TIMEOUT_MS", "invalid");
    expect(aiJobTimeoutMs()).toBe(120_000);
  });
});
