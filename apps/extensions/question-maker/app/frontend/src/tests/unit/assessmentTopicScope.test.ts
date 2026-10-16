import { describe, expect, it } from "vitest";
import { assessmentCoversTopic, getAssessmentTopicIds } from "@/utils/assessmentTopicScope";
import { AssessmentBlueprintConfig } from "@/types/question";

const limitedTo = (primaryTopicIds: string[]) => ({
  blueprintConfig: { primaryTopicIds } as AssessmentBlueprintConfig,
});

describe("getAssessmentTopicIds", () => {
  it("returns the chosen topic ids", () => {
    expect(getAssessmentTopicIds(limitedTo(["t1", "t2"]))).toEqual(["t1", "t2"]);
  });

  it("returns [] for an assessment with no blueprint, a null one, or none at all", () => {
    expect(getAssessmentTopicIds({})).toEqual([]);
    expect(getAssessmentTopicIds({ blueprintConfig: null })).toEqual([]);
    expect(getAssessmentTopicIds(undefined)).toEqual([]);
  });

  it("returns [] when the stored list is not an array", () => {
    // Shaped like a stored blueprint that came back from the API with a bad value.
    const malformed = JSON.parse('{"blueprintConfig":{"primaryTopicIds":"t1"}}');
    expect(getAssessmentTopicIds(malformed)).toEqual([]);
  });
});

describe("assessmentCoversTopic", () => {
  it("covers only its chosen topics when limited", () => {
    expect(assessmentCoversTopic(limitedTo(["t1"]), "t1")).toBe(true);
    expect(assessmentCoversTopic(limitedTo(["t1"]), "t2")).toBe(false);
  });

  it("covers every topic when unrestricted", () => {
    expect(assessmentCoversTopic(limitedTo([]), "t2")).toBe(true);
    expect(assessmentCoversTopic({}, "t2")).toBe(true);
  });

  it("rules nothing out before a topic is chosen", () => {
    expect(assessmentCoversTopic(limitedTo(["t1"]), "")).toBe(true);
  });
});
