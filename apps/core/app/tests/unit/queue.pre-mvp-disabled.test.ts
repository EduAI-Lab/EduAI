// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const workerConstructor = vi.hoisted(() => vi.fn());
const aiJobCreate = vi.hoisted(() => vi.fn());
const aiJobFindUnique = vi.hoisted(() => vi.fn());

vi.mock("bullmq", () => ({
  Worker: class Worker {
    name = "fake-worker";

    constructor(...args: unknown[]) {
      workerConstructor(...args);
    }

    on() {
      return this;
    }

    async close() {}
  },
}));

vi.mock("~/lib/queue/connection.server", () => ({ default: {} }));
vi.mock("~/lib/ai/completion.server", () => ({ runCompletion: vi.fn() }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));
vi.mock("~/lib/prisma.server", () => ({
  default: {
    aiJob: {
      create: aiJobCreate,
      findUnique: aiJobFindUnique,
    },
  },
}));

import { createAiJobWorker, startAiJobWorkers } from "~/lib/queue/worker.server";
import { enqueue } from "~/lib/queue/enqueue.server";

describe("pre-MVP AI-job queue disable", () => {
  beforeEach(() => {
    workerConstructor.mockClear();
    aiJobCreate.mockClear();
    aiJobFindUnique.mockClear();
  });

  it("rejects the generic producer before reading or writing an AiJob", async () => {
    await expect(
      enqueue({
        kind: "question-generation",
        type: "background",
        source: "test",
        userId: "user-1",
        input: {
          kind: "question-generation",
          courseId: "course-1",
          prompt: "sensitive prompt",
          count: 1,
        },
        requestedModel: "openai:client-chosen-model",
        idempotencyKey: "shared-client-key",
      }),
    ).rejects.toThrow(/disabled.*pre-MVP/i);
    expect(aiJobFindUnique).not.toHaveBeenCalled();
    expect(aiJobCreate).not.toHaveBeenCalled();
  });

  it("rejects worker startup before constructing any BullMQ worker", () => {
    expect(() => startAiJobWorkers()).toThrow(/disabled.*pre-MVP/i);
    expect(workerConstructor).not.toHaveBeenCalled();
  });

  it("rejects direct worker construction before touching BullMQ", () => {
    expect(() => createAiJobWorker("ai-jobs-chat")).toThrow(/disabled.*pre-MVP/i);
    expect(workerConstructor).not.toHaveBeenCalled();
  });
});
