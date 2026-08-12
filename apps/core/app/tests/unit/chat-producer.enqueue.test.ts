// @vitest-environment node
//
// #1269 review: no coverage existed for the /api/chat enqueue producer at
// all. This covers that `enqueueQuestionGeneration` builds the right job
// shape and — the specific ask — propagates a `QueueUnavailableError` from
// the underlying `enqueue()` rather than swallowing it, since the route
// (api/chat.ts:813-824) depends on that error surfacing to classify the
// response as 503 via `httpStatusForEnqueueError`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/queue/enqueue.server", () => ({ enqueue: enqueueMock }));

import { enqueueQuestionGeneration } from "~/lib/queue/chat-producer.server";

beforeEach(() => {
  vi.clearAllMocks();
  enqueueMock.mockResolvedValue({ jobId: "job_1" });
});

describe("enqueueQuestionGeneration", () => {
  it("propagates QueueUnavailableError from enqueue() instead of swallowing it", async () => {
    enqueueMock.mockRejectedValueOnce(new QueueUnavailableError("Redis unavailable"));

    await expect(
      enqueueQuestionGeneration({
        body: { source: "question-maker" },
        messages: [{ role: "user", content: "make 5 questions" }],
        userId: "user_1",
        courseId: "course_1",
      }),
    ).rejects.toBeInstanceOf(QueueUnavailableError);
  });

  it("builds a question-generation job from the last user message", async () => {
    await enqueueQuestionGeneration({
      body: { source: "question-maker", count: 3 },
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "make 3 questions about photosynthesis" },
      ],
      userId: "user_1",
      courseId: "course_1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "question-generation",
        source: "question-maker",
        userId: "user_1",
        courseId: "course_1",
        input: expect.objectContaining({
          courseId: "course_1",
          prompt: "make 3 questions about photosynthesis",
          count: 3,
        }),
      }),
    );
  });

  it("passes idempotencyKey through when the request body includes one", async () => {
    await enqueueQuestionGeneration({
      body: { source: "question-maker", idempotencyKey: "chat-idem-1" },
      messages: [{ role: "user", content: "hi" }],
      userId: "user_1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "chat-idem-1" }),
    );
  });
});
