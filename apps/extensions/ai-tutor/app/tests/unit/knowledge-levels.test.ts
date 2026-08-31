import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWLEDGE_LEVEL,
  KNOWLEDGE_LEVELS,
  knowledgeLevelLabel,
} from "~/lib/knowledge-levels";

describe("knowledgeLevelLabel", () => {
  it("returns the matching level's label", () => {
    expect(knowledgeLevelLabel("beginner")).toBe("Beginner");
    expect(knowledgeLevelLabel("intermediate")).toBe("Intermediate");
    expect(knowledgeLevelLabel("advanced")).toBe("Advanced");
  });

  it("title-cases an unknown value as a fallback", () => {
    expect(knowledgeLevelLabel("expert")).toBe("Expert");
  });

  it("returns an empty string for null/undefined", () => {
    expect(knowledgeLevelLabel(null)).toBe("");
    expect(knowledgeLevelLabel(undefined)).toBe("");
    expect(knowledgeLevelLabel("")).toBe("");
  });

  it("exposes a sensible default level and full list", () => {
    expect(DEFAULT_KNOWLEDGE_LEVEL).toBe("intermediate");
    expect(KNOWLEDGE_LEVELS).toHaveLength(3);
  });
});
