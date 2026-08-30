import { describe, expect, it } from "vitest";
import { resolveCourseTab } from "./courseTabs";

describe("resolveCourseTab", () => {
  it("keeps a valid requested tab", () => {
    expect(resolveCourseTab("banks", true)).toBe("banks");
  });

  it("falls back to overview for an unknown tab", () => {
    expect(resolveCourseTab("nope", true)).toBe("overview");
    expect(resolveCourseTab(null, true)).toBe("overview");
  });

  it("keeps the canvas tab for a course synced from Canvas", () => {
    expect(resolveCourseTab("canvas", true)).toBe("canvas");
  });

  it("redirects the canvas tab to overview for a course not synced from Canvas", () => {
    expect(resolveCourseTab("canvas", false)).toBe("overview");
  });

  it("keeps the canvas tab while the Canvas link is still resolving", () => {
    expect(resolveCourseTab("canvas", null)).toBe("canvas");
  });
});
