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
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: "2025-09-01",
      instructorUserIds: ["user-1"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.aiInstructions).toBe("");
      expect(r.data.isPublished).toBe(false);
    }
  });

  it("rejects non-integer year", () => {
    expect(
      CreateCourseSchema.safeParse({
        name: "X",
        code: "X",
        section: "001",
        term: "Fall",
        year: 2025.5,
        startDate: "2025-09-01",
        instructorUserIds: ["user-1"],
      }).success,
    ).toBe(false);
  });

  it("requires non-empty name and code", () => {
    expect(
      CreateCourseSchema.safeParse({
        name: "",
        code: "",
        section: "001",
        term: "Fall",
        year: 2025,
        startDate: "2025-09-01",
        instructorUserIds: ["user-1"],
      }).success,
    ).toBe(false);
  });

  it("requires at least one instructorUserId", () => {
    expect(
      CreateCourseSchema.safeParse({
        name: "Intro to CS",
        code: "CS101",
        section: "001",
        term: "Fall",
        year: 2025,
        startDate: "2025-09-01",
        instructorUserIds: [],
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
