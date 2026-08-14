// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/queue/enqueue.server", () => ({ enqueue: enqueueMock }));

import { enqueueQuestionGeneration, isEnqueueRequested } from "~/lib/queue/chat-producer.server";

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
  it("is false when the feature flag is off, even if the body opts in", () => {
    expect(isEnqueueRequested({ enqueue: true })).toBe(false);
  });

  it("is true only when the flag is on AND the body opts in", () => {
    process.env.QUEUE_ENQUEUE_ENABLED = "true";
    expect(isEnqueueRequested({ enqueue: true })).toBe(true);
    expect(isEnqueueRequested({ enqueue: false })).toBe(false);
    expect(isEnqueueRequested({})).toBe(false);
  });

  it("handles non-object bodies safely", () => {
    process.env.QUEUE_ENQUEUE_ENABLED = "true";
    expect(isEnqueueRequested(null)).toBe(false);
    expect(isEnqueueRequested("enqueue")).toBe(false);
    expect(isEnqueueRequested(undefined)).toBe(false);
  });
});

describe("enqueueQuestionGeneration", () => {
  const messages = [
    { role: "assistant", content: "How can I help?" },
    { role: "user", content: "Make me 3 questions about recursion" },
  ];

  it("builds a background job from an explicit routingContext.jobType", async () => {
    await enqueueQuestionGeneration({
      body: { routingContext: { jobType: "interactive" }, count: 3, source: "question-maker" },
      messages,
      userId: "user-1",
      courseId: "course-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "question-generation",
        type: "interactive",
        source: "question-maker",
        userId: "user-1",
        courseId: "course-1",
        input: {
          kind: "question-generation",
          courseId: "course-1",
          prompt: "Make me 3 questions about recursion",
          count: 3,
        },
      }),
    );
  });

  it("derives the job type from the workload feature when routingContext.jobType is absent", async () => {
    await enqueueQuestionGeneration({
      body: { routingContext: { feature: "question-maker" } },
      messages,
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ type: "background" }));
  });

  it("defaults to interactive for an unrecognized workload feature", async () => {
    await enqueueQuestionGeneration({
      body: {},
      messages,
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ type: "interactive" }));
  });

  it("defaults count to 1 and source to 'unknown' when absent or invalid", async () => {
    await enqueueQuestionGeneration({
      body: { count: "not-a-number" },
      messages,
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "unknown",
        input: expect.objectContaining({ count: 1 }),
      }),
    );
  });

  it("extracts the latest user prompt from array-shaped content parts", async () => {
    await enqueueQuestionGeneration({
      body: {},
      messages: [
        { role: "user", content: [{ text: "part one " }, { text: "part two" }] },
      ],
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ prompt: "part one part two" }),
      }),
    );
  });

  it("falls back to an empty prompt when no user message is found", async () => {
    await enqueueQuestionGeneration({
      body: {},
      messages: [{ role: "assistant", content: "hi" }],
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ prompt: "" }) }),
    );
  });

  it("skips malformed message entries while scanning for the latest user prompt", async () => {
    await enqueueQuestionGeneration({
      body: {},
      messages: [null, "not an object", { role: "user", content: "found it" }],
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ prompt: "found it" }) }),
    );
  });

  it("passes through requestedModel and idempotencyKey when present", async () => {
    await enqueueQuestionGeneration({
      body: { idempotencyKey: "key-1" },
      messages,
      userId: "user-1",
      requestedModel: "auto",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedModel: "auto", idempotencyKey: "key-1" }),
    );
  });

  it("defaults courseId to an empty string and leaves idempotencyKey undefined when absent", async () => {
    await enqueueQuestionGeneration({
      body: {},
      messages,
      userId: "user-1",
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: undefined,
        idempotencyKey: undefined,
        input: expect.objectContaining({ courseId: "" }),
      }),
    );
  });

  it("returns the result from enqueue()", async () => {
    const result = await enqueueQuestionGeneration({ body: {}, messages, userId: "user-1" });
    expect(result).toEqual({ jobId: "job-1", queuePosition: 1, queueDepth: 1 });
  });
});
