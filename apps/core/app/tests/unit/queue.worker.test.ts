// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { JobPayload } from "~/lib/queue/job-schema";

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
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn().mockResolvedValue(undefined),
}));

import { enqueue } from "~/lib/queue/enqueue.server";
import {
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
  data: JobPayload = payload,
  overrides: Partial<Job<JobPayload>> = {},
): Job<JobPayload> {
  return {
    id: "bull_1",
    name: data.kind,
    data,
    attemptsMade: 0,
    opts: {},
    ...overrides,
  } as Job<JobPayload>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  prismaMock.aiJob.create.mockResolvedValue({ id: "aijob_1" });
  prismaMock.aiJob.update.mockResolvedValue({});
  prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.aiJob.delete.mockResolvedValue({});
  queueAdd.mockResolvedValue({ id: "bull_1" });
});

describe("AI-job dequeue worker", () => {
  it("consumes the exact producer payload and completes the durable row", async () => {
    let emittedPayload: JobPayload | undefined;
    queueAdd.mockImplementation(
      async (_name: string, data: JobPayload) => {
        emittedPayload = data;
        return { id: "bull_1" };
      },
    );

    await expect(enqueue(payload)).resolves.toEqual({ jobId: "aijob_1" });
    expect(emittedPayload).toEqual(payload);

    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "PENDING",
      startedAt: null,
      userId: "user_1",
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
      where: {
        queueName_bullJobId: {
          queueName: "ai-jobs-chat",
          bullJobId: "bull_1",
        },
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        userId: true,
      },
    });
    expect(prismaMock.aiJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "aijob_1",
          status: { in: ["PENDING", "RUNNING"] },
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

  it("leaves a cancelled row terminal and skips inference", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({
      id: "aijob_1",
      status: "CANCELLED",
      startedAt: null,
      userId: "user_1",
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
      status: "RUNNING",
      startedAt: new Date("2026-07-27T00:00:00Z"),
      userId: "user_1",
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
      }),
    );
  });

  it("uses independently configurable chat and heavy concurrency", () => {
    vi.stubEnv("AI_JOB_CHAT_CONCURRENCY", "12");
    vi.stubEnv("AI_JOB_HEAVY_CONCURRENCY", "2");
    expect(workerConcurrency("ai-jobs-chat")).toBe(12);
    expect(workerConcurrency("ai-jobs-heavy")).toBe(2);
  });
});
