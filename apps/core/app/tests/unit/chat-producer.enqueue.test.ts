// @vitest-environment node
//
// The pre-MVP queue boundary is intentionally fail-closed. Keep this seam
// covered so dormant callers cannot persist client-controlled job data merely
// by setting the legacy enqueue flag.

import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/queue/enqueue.server", () => ({ enqueue: enqueueMock }));

import { enqueueQuestionGeneration } from "~/lib/queue/chat-producer.server";
import { AiJobQueueDisabledError } from "~/lib/queue/availability.server";

beforeEach(() => {
  vi.clearAllMocks();
  enqueueMock.mockResolvedValue({ jobId: "job_1" });
});

describe("enqueueQuestionGeneration", () => {
  it("fails closed while the pre-MVP queue is disabled", async () => {
    await expect(
      enqueueQuestionGeneration({
        body: {
          source: "question-maker",
          idempotencyKey: "attacker-chosen-key",
          routingContext: { jobType: "background" },
        },
        messages: [{ role: "user", content: "sensitive prompt" }],
        userId: "user_1",
        courseId: "course_1",
      }),
    ).rejects.toMatchObject({
      name: "AiJobQueueDisabledError",
      code: "AI_JOB_QUEUE_DISABLED_PRE_MVP",
    } satisfies Partial<AiJobQueueDisabledError>);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does not inspect or persist request content while disabled", async () => {
    await expect(
      enqueueQuestionGeneration({
        body: { source: "question-maker", count: 3 },
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "reply" },
          { role: "user", content: "make 3 questions about photosynthesis" },
        ],
        userId: "user_1",
        courseId: "course_1",
      }),
    ).rejects.toBeInstanceOf(AiJobQueueDisabledError);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
