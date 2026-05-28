import { describe, it, expect } from "vitest";
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  CreateCourseTopicSchema,
  DeleteCourseTopicSchema,
} from "~/lib/courses/schemas";

describe("CreateCourseSchema", () => {
  it("accepts valid input and defaults aiInstructions to an empty string", () => {
    const r = CreateCourseSchema.safeParse({
      name: "Intro to CS",
      code: "CS101",
      term: "Fall",
      year: 2025,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.aiInstructions).toBe("");
  });

  it("rejects non-integer year", () => {
    expect(
      CreateCourseSchema.safeParse({
        name: "X",
        code: "X",
        term: "Fall",
        year: 2025.5,
      }).success,
    ).toBe(false);
  });

  it("requires non-empty name and code", () => {
    expect(
      CreateCourseSchema.safeParse({
        name: "",
        code: "",
        term: "Fall",
        year: 2025,
      }).success,
    ).toBe(false);
  });
});

describe("UpdateCourseSchema", () => {
  it("accepts an empty patch", () => {
    expect(UpdateCourseSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an empty name when provided", () => {
    expect(UpdateCourseSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a non-integer year when provided", () => {
    expect(UpdateCourseSchema.safeParse({ year: 2025.5 }).success).toBe(false);
  });
});

describe("CreateCourseTopicSchema", () => {
  it("requires a non-empty name", () => {
    expect(CreateCourseTopicSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateCourseTopicSchema.safeParse({ name: "Algebra" }).success).toBe(true);
  });
});

describe("DeleteCourseTopicSchema", () => {
  it("rejects an empty payload", () => {
    expect(DeleteCourseTopicSchema.safeParse({}).success).toBe(false);
  });

  it("accepts topicId alone", () => {
    expect(DeleteCourseTopicSchema.safeParse({ topicId: "t1" }).success).toBe(true);
  });

  it("accepts name alone", () => {
    expect(DeleteCourseTopicSchema.safeParse({ name: "Algebra" }).success).toBe(true);
  });

  it("accepts both fields together", () => {
    expect(
      DeleteCourseTopicSchema.safeParse({ topicId: "t1", name: "Algebra" }).success,
    ).toBe(true);
  });
});
