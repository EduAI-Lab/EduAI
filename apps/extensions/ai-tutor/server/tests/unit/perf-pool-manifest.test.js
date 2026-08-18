import { describe, it, expect } from "vitest";
import { previousCourseId } from "../../prisma/perf-pool-manifest.js";

// The perf seed re-reads `.perf-pool/aitutor.json` to find the previous pool
// before reseeding. `previousCourseId` is the gate that decides whether a
// manifest is safe to delete from; these tests pin that selection rule.
describe("perf pool manifest cleanup selection", () => {
  it("returns the course id from a current-format manifest", () => {
    expect(previousCourseId({ courseId: 42, seededModuleId: 7 })).toBe(42);
  });

  it("falls back to the legacy nativeCourseId field (pre-#1072 manifest)", () => {
    expect(previousCourseId({ nativeCourseId: 7, poolModulesReuse: [1] })).toBe(7);
  });

  it("rejects non-object manifests", () => {
    expect(previousCourseId(null)).toBeNull();
    expect(previousCourseId(undefined)).toBeNull();
    expect(previousCourseId("x")).toBeNull();
    expect(previousCourseId(42)).toBeNull();
    expect(previousCourseId([1, 2])).toBeNull();
  });

  it("rejects a missing, non-integer, zero, or negative course id", () => {
    expect(previousCourseId({})).toBeNull();
    expect(previousCourseId({ courseId: "42", seededModuleId: 7 })).toBeNull();
    expect(previousCourseId({ courseId: 0, seededModuleId: 7 })).toBeNull();
    expect(previousCourseId({ courseId: -1, seededModuleId: 7 })).toBeNull();
    expect(previousCourseId({ courseId: 4.5, seededModuleId: 7 })).toBeNull();
  });

  it("rejects an id that is not backed by any recognizable pool field", () => {
    expect(previousCourseId({ courseId: 42 })).toBeNull();
    expect(previousCourseId({ courseId: 42, somethingElse: true })).toBeNull();
  });
});
