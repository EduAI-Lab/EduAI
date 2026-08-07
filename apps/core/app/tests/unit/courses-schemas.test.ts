import { describe, it, expect } from "vitest";
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  UpdateCourseRagSettingsSchema,
  CreateCourseTopicSchema,
  DeleteCourseTopicSchema,
} from "~/lib/courses/schemas";

describe("CreateCourseSchema", () => {
  it("accepts valid input and defaults aiInstructions to an empty string", () => {
    const r = CreateCourseSchema.safeParse({
      name: "Intro to CS",
      code: "CS101",
      section: "001",
      term: "W1",
      year: 2025,
      startDate: "2025-09-01",
      department: "COSC",
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
        term: "W1",
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
        term: "W1",
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
        term: "W1",
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

describe("UpdateCourseRagSettingsSchema", () => {
  it("accepts scope guardrail and valid RAG settings", () => {
    const result = UpdateCourseRagSettingsSchema.safeParse({
      courseScopeGuardrailEnabled: false,
      ragTopK: 6,
      ragSimilarityThreshold: 0.6,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        courseScopeGuardrailEnabled: false,
        ragTopK: 6,
        ragSimilarityThreshold: 0.6,
      });
    }
  });

  it("accepts null to clear overrides", () => {
    const result = UpdateCourseRagSettingsSchema.safeParse({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty patch", () => {
    expect(UpdateCourseRagSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects ragTopK below 1 or above 20", () => {
    expect(
      UpdateCourseRagSettingsSchema.safeParse({ ragTopK: 0 }).success,
    ).toBe(false);
    expect(
      UpdateCourseRagSettingsSchema.safeParse({ ragTopK: 21 }).success,
    ).toBe(false);
  });

  it("rejects ragSimilarityThreshold outside (0, 1)", () => {
    expect(
      UpdateCourseRagSettingsSchema.safeParse({ ragSimilarityThreshold: 0 })
        .success,
    ).toBe(false);
    expect(
      UpdateCourseRagSettingsSchema.safeParse({ ragSimilarityThreshold: 1 })
        .success,
    ).toBe(false);
  });

  it("rejects non-boolean scope guardrail values", () => {
    expect(
      UpdateCourseRagSettingsSchema.safeParse({
        courseScopeGuardrailEnabled: "false",
      }).success,
    ).toBe(false);
  });
});

describe("CreateCourseTopicSchema", () => {
  it("requires a non-empty name", () => {
    expect(CreateCourseTopicSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateCourseTopicSchema.safeParse({ name: "Algebra" }).success).toBe(
      true,
    );
  });
});

describe("DeleteCourseTopicSchema", () => {
  it("rejects an empty payload", () => {
    expect(DeleteCourseTopicSchema.safeParse({}).success).toBe(false);
  });

  it("accepts topicId alone", () => {
    expect(DeleteCourseTopicSchema.safeParse({ topicId: "t1" }).success).toBe(
      true,
    );
  });

  it("accepts name alone", () => {
    expect(DeleteCourseTopicSchema.safeParse({ name: "Algebra" }).success).toBe(
      true,
    );
  });

  it("accepts both fields together", () => {
    expect(
      DeleteCourseTopicSchema.safeParse({ topicId: "t1", name: "Algebra" })
        .success,
    ).toBe(true);
  });
});
