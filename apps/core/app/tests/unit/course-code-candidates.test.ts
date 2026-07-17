// @vitest-environment node
import { describe, it, expect } from "vitest";
import { courseCodeLookupCandidates } from "~/lib/courses/course-code-candidates";

describe("courseCodeLookupCandidates", () => {
  it("returns trimmed, compact, and spaced variants for a compact code", () => {
    expect(courseCodeLookupCandidates("COSC121")).toEqual([
      "COSC121",
      "COSC 121",
    ]);
  });

  it("keeps an already-spaced code and still includes the compact form", () => {
    expect(courseCodeLookupCandidates("  COSC 121  ")).toEqual([
      "COSC 121",
      "COSC121",
    ]);
  });

  it("dedupes when trim/compact/spaced collapse to the same string", () => {
    expect(courseCodeLookupCandidates("MATH")).toEqual(["MATH"]);
  });

  it("returns an empty list for blank input", () => {
    expect(courseCodeLookupCandidates("   ")).toEqual([]);
  });
});
