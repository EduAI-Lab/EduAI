// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  courseMatchesTermBucket,
  filterCoursesByTermBucket,
  termBucketFor,
} from "~/lib/courses/term-filter";

describe("term-filter", () => {
  it("maps Fall/Winter to T1 and Spring/Summer to T2", () => {
    expect(termBucketFor("Fall")).toBe("t1");
    expect(termBucketFor("Winter")).toBe("t1");
    expect(termBucketFor("Spring")).toBe("t2");
    expect(termBucketFor("Summer")).toBe("t2");
  });

  it("filters courses by bucket", () => {
    const courses = [
      { id: "1", term: "Fall" },
      { id: "2", term: "Spring" },
      { id: "3", term: "Custom" },
    ];
    expect(filterCoursesByTermBucket(courses, "t1")).toEqual([{ id: "1", term: "Fall" }]);
    expect(filterCoursesByTermBucket(courses, "all")).toHaveLength(3);
  });

  it("excludes unknown terms from T1/T2 filters", () => {
    expect(courseMatchesTermBucket({ term: "Custom" }, "t1")).toBe(false);
    expect(courseMatchesTermBucket({ term: "Custom" }, "all")).toBe(true);
  });
});
