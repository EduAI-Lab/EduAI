// @vitest-environment node

import { describe, it, expect } from "vitest";
import { JobPayloadSchema } from "~/lib/queue/job-schema";

const base = {
  kind: "question-generation" as const,
  type: "background" as const,
  source: "question-maker",
  userId: "user_1",
  courseId: "course_1",
  input: {
    kind: "question-generation" as const,
    courseId: "course_1",
    prompt: "Generate 5 questions on photosynthesis",
    count: 5,
  },
};

describe("JobPayloadSchema", () => {
  it("accepts a valid question-generation payload", () => {
    const parsed = JobPayloadSchema.parse(base);
    expect(parsed.kind).toBe("question-generation");
    expect(parsed.input.count).toBe(5);
  });

  it("rejects an unknown kind", () => {
    expect(() => JobPayloadSchema.parse({ ...base, kind: "summarization" })).toThrow();
  });

  it("rejects when input.kind disagrees with the top-level kind", () => {
    const bad = { ...base, input: { ...base.input, kind: "something-else" } };
    expect(() => JobPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects count outside 1..100", () => {
    expect(() => JobPayloadSchema.parse({ ...base, input: { ...base.input, count: 0 } })).toThrow();
    expect(() => JobPayloadSchema.parse({ ...base, input: { ...base.input, count: 101 } })).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() => JobPayloadSchema.parse({ ...base, input: { ...base.input, count: 2.5 } })).toThrow();
  });

  it("rejects an invalid type", () => {
    expect(() => JobPayloadSchema.parse({ ...base, type: "urgent" })).toThrow();
  });

  it("requires a non-empty source", () => {
    expect(() => JobPayloadSchema.parse({ ...base, source: "" })).toThrow();
  });

  it("allows optional requestedModel and idempotencyKey", () => {
    const parsed = JobPayloadSchema.parse({
      ...base,
      requestedModel: "vllm:qwen2.5-32b-instruct",
      idempotencyKey: "idem-1",
    });
    expect(parsed.requestedModel).toBe("vllm:qwen2.5-32b-instruct");
    expect(parsed.idempotencyKey).toBe("idem-1");
  });
});
