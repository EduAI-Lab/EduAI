/**
 * Unit tests for the assessment topic-scope helpers (#1974): parsing the
 * stored selection, normalizing client input, and the on-topic assertion.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({ prisma: {} }));

const {
  assessmentTopicScope,
  normalizeTopicIdList,
  assertQuestionInAssessmentTopics,
  topicConflictError,
} = await import("../../src/services/assessmentTopicScope.js");

describe("assessmentTopicScope", () => {
  it.each([
    ["no assessment", undefined],
    ["no blueprintConfig", {}],
    ["null blueprintConfig", { blueprintConfig: null }],
    ["missing primaryTopicIds", { blueprintConfig: { studyRole: "x" } }],
    ["non-array primaryTopicIds", { blueprintConfig: { primaryTopicIds: "t1" } }],
    ["empty array", { blueprintConfig: { primaryTopicIds: [] } }],
    ["only blank/non-string entries", { blueprintConfig: { primaryTopicIds: ["", "  ", 3] } }],
  ])("is unrestricted for %s", (_label, assessment) => {
    expect(assessmentTopicScope(assessment)).toBeNull();
  });

  it("returns the set of chosen ids", () => {
    const scope = assessmentTopicScope({ blueprintConfig: { primaryTopicIds: ["t1", " t2 "] } });
    expect(scope).toEqual(new Set(["t1", "t2"]));
  });
});

describe("normalizeTopicIdList", () => {
  it("treats undefined/null as empty", () => {
    expect(normalizeTopicIdList(undefined)).toEqual([]);
    expect(normalizeTopicIdList(null)).toEqual([]);
  });

  it("trims, drops empties and dedupes in first-seen order", () => {
    expect(normalizeTopicIdList([" b", "a", "", "b", "a "])).toEqual(["b", "a"]);
  });

  it.each([
    ["string", "t1"],
    ["object", { a: 1 }],
    ["number entry", ["t1", 2]],
    ["null entry", [null]],
  ])("rejects a %s with QM_ASSESSMENT_TOPICS_INVALID", (_label, value) => {
    expect(() => normalizeTopicIdList(value)).toThrow(
      expect.objectContaining({
        status: 400,
        code: "QM_ASSESSMENT_TOPICS_INVALID",
        isPublic: true,
      }),
    );
  });
});

describe("assertQuestionInAssessmentTopics", () => {
  const limited = { blueprintConfig: { primaryTopicIds: ["t1", "t2"] } };

  it("allows anything when unrestricted", () => {
    expect(() => assertQuestionInAssessmentTopics({ blueprintConfig: null }, "t9")).not.toThrow();
  });

  it("allows a chosen topic", () => {
    expect(() => assertQuestionInAssessmentTopics(limited, "t2")).not.toThrow();
  });

  it("rejects an off-topic question", () => {
    expect(() => assertQuestionInAssessmentTopics(limited, "t3")).toThrow(
      expect.objectContaining({
        status: 400,
        statusCode: 400,
        code: "QM_VARIANT_OUTSIDE_ASSESSMENT_TOPICS",
        isPublic: true,
      }),
    );
  });
});

describe("topicConflictError", () => {
  it("is a public 409 carrying the questions as details", () => {
    const err = topicConflictError("nope", [{ id: 1, description: "Q1" }]);
    expect(err).toMatchObject({
      message: "nope",
      status: 409,
      statusCode: 409,
      code: "QM_ASSESSMENT_TOPIC_CONFLICT",
      isPublic: true,
      details: { questions: [{ id: 1, description: "Q1" }] },
    });
  });
});
