// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "~/lib/prisma.server";
import redis from "~/lib/queue/connection.server";
import { enqueue } from "~/lib/queue/enqueue.server";
import type { JobPayload } from "~/lib/queue/job-schema";
import { getQueue } from "~/lib/queue/queues.server";
import {
  closeAiJobWorkers,
  createAiJobWorker,
  type AiJobResult,
} from "~/lib/queue/worker.server";

const queueName = "ai-jobs-chat" as const;
const queue = getQueue(queueName);
const source = `queue-worker-integration-${randomUUID()}`;
const idempotencyKey = `queue-worker-${randomUUID()}`;
const workers: ReturnType<typeof createAiJobWorker>[] = [];

beforeAll(async () => {
  await queue.drain(true);
});

afterAll(async () => {
  await closeAiJobWorkers(workers);
  await queue.drain(true);
  await queue.clean(0, 1_000, "completed");
  await queue.clean(0, 1_000, "failed");
  await prisma.aiJob.deleteMany({ where: { source } });
  await queue.close();
  await redis.quit();
});

describe("AI-job dequeue worker integration (#916)", () => {
  it("consumes a real Redis job and persists PENDING -> RUNNING -> COMPLETED", async () => {
    const execute = vi.fn(async (payload: JobPayload): Promise<AiJobResult> => {
      const running = await prisma.aiJob.findFirstOrThrow({ where: { source } });
      expect(running.status).toBe("RUNNING");
      expect(running.attempts).toBe(1);

      return {
        kind: payload.kind,
        model: "vllm:integration-stub",
        output: {
          content: '[{"question":"What is a queue?"}]',
          requestedCount: payload.input.count,
        },
      };
    });
    const worker = createAiJobWorker(queueName, { autorun: false }, execute);
    workers.push(worker);

    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for BullMQ completion")),
        15_000,
      );
      worker.once("completed", () => {
        clearTimeout(timer);
        resolve();
      });
      worker.once("failed", (_job, error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const payload: JobPayload = {
      kind: "question-generation",
      type: "interactive",
      source,
      userId: `integration-user-${randomUUID()}`,
      input: {
        kind: "question-generation",
        courseId: `integration-course-${randomUUID()}`,
        prompt: "Generate one question about queues.",
        count: 1,
      },
      requestedModel: "vllm:integration-stub",
      idempotencyKey,
    };

    const { jobId } = await enqueue(payload);
    const pending = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(pending.status).toBe("PENDING");

    void worker.run();
    await completed;

    const row = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.status).toBe("COMPLETED");
    expect(row.attempts).toBe(1);
    expect(row.startedAt).not.toBeNull();
    expect(row.completedAt).not.toBeNull();
    expect(row.errorMessage).toBeNull();
    expect(row.result).toEqual({
      kind: "question-generation",
      model: "vllm:integration-stub",
      output: {
        content: '[{"question":"What is a queue?"}]',
        requestedCount: 1,
      },
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
