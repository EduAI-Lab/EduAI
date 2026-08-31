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

const topicBase = {
  kind: "topic-analysis" as const,
  type: "background" as const,
  source: "core",
  userId: "user_1",
  courseId: "course_1",
  input: {
    kind: "topic-analysis" as const,
    courseId: "course_1",
    materialIds: ["material_1", "material_2"],
    canvasCourseId: "canvas_1" as string | null | undefined,
  },
};

describe("JobPayloadSchema", () => {
  it("accepts a valid question-generation payload", () => {
    const parsed = JobPayloadSchema.parse(base);
    expect(parsed.kind).toBe("question-generation");
    // Narrow before reading kind-specific fields — `input` is a discriminated
    // union now that topic-analysis (#1624) shares the schema.
    expect(parsed.input.kind === "question-generation" && parsed.input.count).toBe(5);
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
    expect(() =>
      JobPayloadSchema.parse({ ...base, input: { ...base.input, count: 101 } }),
    ).toThrow();
  });

  it("rejects a non-integer count", () => {
    expect(() =>
      JobPayloadSchema.parse({ ...base, input: { ...base.input, count: 2.5 } }),
    ).toThrow();
  });

  it("rejects an invalid type", () => {
    expect(() => JobPayloadSchema.parse({ ...base, type: "urgent" })).toThrow();
  });

  it("requires a non-empty source", () => {
    expect(() => JobPayloadSchema.parse({ ...base, source: "" })).toThrow();
  });

  it("accepts a valid topic-analysis payload", () => {
    const parsed = JobPayloadSchema.parse(topicBase);
    expect(parsed.kind).toBe("topic-analysis");
    expect(parsed.input.kind === "topic-analysis" && parsed.input.materialIds).toEqual([
      "material_1",
      "material_2",
    ]);
  });

  it("requires at least one materialId", () => {
    expect(() =>
      JobPayloadSchema.parse({ ...topicBase, input: { ...topicBase.input, materialIds: [] } }),
    ).toThrow();
  });

  // The 500 cap is what keeps one sync batch from being enqueued as a single
  // unbounded job; a batch that large is a bug in the producer, not a big course.
  it("rejects more than 500 materialIds", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `material_${i}`);
    expect(() =>
      JobPayloadSchema.parse({
        ...topicBase,
        input: { ...topicBase.input, materialIds: tooMany },
      }),
    ).toThrow();
    const atCap = Array.from({ length: 500 }, (_, i) => `material_${i}`);
    expect(() =>
      JobPayloadSchema.parse({ ...topicBase, input: { ...topicBase.input, materialIds: atCap } }),
    ).not.toThrow();
  });

  it("rejects an empty materialId string", () => {
    expect(() =>
      JobPayloadSchema.parse({ ...topicBase, input: { ...topicBase.input, materialIds: [""] } }),
    ).toThrow();
  });

  it("rejects an empty courseId on a topic-analysis input", () => {
    expect(() =>
      JobPayloadSchema.parse({ ...topicBase, input: { ...topicBase.input, courseId: "" } }),
    ).toThrow();
  });

  // Nullish, not merely optional — a non-Canvas batch sends null rather than
  // omitting the key, and both must parse.
  it("accepts canvasCourseId present, null, or omitted", () => {
    expect(() =>
      JobPayloadSchema.parse({
        ...topicBase,
        input: { ...topicBase.input, canvasCourseId: "canvas_9" },
      }),
    ).not.toThrow();
    expect(() =>
      JobPayloadSchema.parse({
        ...topicBase,
        input: { ...topicBase.input, canvasCourseId: null },
      }),
    ).not.toThrow();
    const { canvasCourseId: _omitted, ...withoutCanvas } = topicBase.input;
    expect(() => JobPayloadSchema.parse({ ...topicBase, input: withoutCanvas })).not.toThrow();
  });

  it("rejects an empty canvasCourseId", () => {
    expect(() =>
      JobPayloadSchema.parse({ ...topicBase, input: { ...topicBase.input, canvasCourseId: "" } }),
    ).toThrow();
  });

  it("rejects a topic-analysis input under a question-generation kind", () => {
    expect(() => JobPayloadSchema.parse({ ...topicBase, kind: "question-generation" })).toThrow();
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
