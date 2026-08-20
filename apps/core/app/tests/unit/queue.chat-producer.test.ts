// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/queue/enqueue.server", () => ({ enqueue: enqueueMock }));

import { enqueueQuestionGeneration, isEnqueueRequested } from "~/lib/queue/chat-producer.server";
import {
  AI_JOB_QUEUE_PRE_MVP_DISABLED,
  AiJobQueueDisabledError,
} from "~/lib/queue/availability.server";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.QUEUE_ENQUEUE_ENABLED;
  enqueueMock.mockResolvedValue({ jobId: "job-1", queuePosition: 1, queueDepth: 1 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isEnqueueRequested", () => {
  it.each([undefined, "", "false", "true", "TRUE", "1"])(
    "cannot be enabled by the legacy environment flag before MVP (%s)",
    (legacyFlag) => {
      if (legacyFlag === undefined) {
        delete process.env.QUEUE_ENQUEUE_ENABLED;
      } else {
        process.env.QUEUE_ENQUEUE_ENABLED = legacyFlag;
      }

      expect(AI_JOB_QUEUE_PRE_MVP_DISABLED).toBe(true);
      expect(isEnqueueRequested({ enqueue: true })).toBe(false);
    },
  );

  it.each([null, "enqueue", undefined, {}, { enqueue: false }])(
    "rejects every request body shape while the queue is disabled",
    (body) => {
      process.env.QUEUE_ENQUEUE_ENABLED = "true";
      expect(isEnqueueRequested(body)).toBe(false);
    },
  );
});

describe("enqueueQuestionGeneration", () => {
  it("fails closed before touching the queue or persisting client-controlled fields", async () => {
    process.env.QUEUE_ENQUEUE_ENABLED = "true";

    await expect(
      enqueueQuestionGeneration({
        body: {
          enqueue: true,
          idempotencyKey: "attacker-chosen-key",
          routingContext: { jobType: "background" },
        },
        messages: [{ role: "user", content: "sensitive prompt" }],
        userId: "user-1",
        requestedModel: "openai:attacker-chosen-model",
      }),
    ).rejects.toMatchObject({
      name: "AiJobQueueDisabledError",
      code: "AI_JOB_QUEUE_DISABLED_PRE_MVP",
    } satisfies Partial<AiJobQueueDisabledError>);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
