/**
 * Unit tests for normalizeCourseCode and courseCodeLookupCandidates.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeCourseCode,
  courseCodeLookupCandidates,
} from "../../src/services/courseCodeUtils.js";

describe("normalizeCourseCode", () => {
  it("lowercases and strips whitespace", () => {
    expect(normalizeCourseCode("COSC 121")).toBe("cosc121");
  });

  it("returns empty string for missing values", () => {
    expect(normalizeCourseCode(null)).toBe("");
    expect(normalizeCourseCode("")).toBe("");
  });
});

describe("courseCodeLookupCandidates (#1362)", () => {
  it("expands compact codes to a spaced Core-style variant", () => {
    expect(courseCodeLookupCandidates("COSC121")).toEqual(["COSC121", "COSC 121"]);
  });

  it("keeps trimmed spaced codes and also tries the compact form", () => {
    expect(courseCodeLookupCandidates("  COSC 121  ")).toEqual([
      "COSC 121",
      "COSC121",
    ]);
  });

  it("returns empty for blank input", () => {
    expect(courseCodeLookupCandidates("   ")).toEqual([]);
  });
});
