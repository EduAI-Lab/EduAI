// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  courseCodeLookupCandidates,
  pickCourseIdByCandidatePriority,
} from "~/lib/courses/course-code-candidates";

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

  it("preserves caller casing (case folding is done at the query layer)", () => {
    expect(courseCodeLookupCandidates("cosc121")).toEqual([
      "cosc121",
      "cosc 121",
    ]);
  });

  it("dedupes when trim/compact/spaced collapse to the same string", () => {
    expect(courseCodeLookupCandidates("MATH")).toEqual(["MATH"]);
  });

  it("returns an empty list for blank input", () => {
    expect(courseCodeLookupCandidates("   ")).toEqual([]);
  });
});

describe("pickCourseIdByCandidatePriority", () => {
  it("picks the first candidate match case-insensitively", () => {
    const id = pickCourseIdByCandidatePriority(
      ["cosc121", "cosc 121"],
      [{ id: "c1", code: "COSC 121" }],
    );
    expect(id).toBe("c1");
  });

  it("prefers earlier candidates when multiple rows match", () => {
    const id = pickCourseIdByCandidatePriority(
      ["COSC121", "COSC 121"],
      [
        { id: "spaced", code: "COSC 121" },
        { id: "compact", code: "COSC121" },
      ],
    );
    expect(id).toBe("compact");
  });
});
