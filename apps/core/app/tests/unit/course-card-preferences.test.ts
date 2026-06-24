import { describe, it, expect, beforeEach } from "vitest";
import {
  COURSE_CARD_PREFERENCES_KEY,
  getCourseDisplayName,
  getCourseHeroColor,
  mergeCourseCardPreference,
  normalizeCourseCardColor,
  readCourseCardPreferences,
  resolveCourseAccentColor,
  writeCourseCardPreferences,
} from "~/lib/courses/course-card-preferences";

describe("course-card-preferences", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("normalizes hex colours", () => {
    expect(normalizeCourseCardColor("1a76b8")).toBe("#1a76b8");
    expect(normalizeCourseCardColor("#1A76B8")).toBe("#1a76b8");
    expect(normalizeCourseCardColor("not-a-color")).toBeNull();
  });

  it("reads and writes localStorage map", () => {
    writeCourseCardPreferences({
      "course-1": { color: "oklch(0.56 0.20 255)", nickname: "My CS course" },
    });
    expect(readCourseCardPreferences()["course-1"]?.nickname).toBe("My CS course");
  });

  it("removes empty preferences on merge", () => {
    const next = mergeCourseCardPreference(
      { c1: { color: "oklch(0.56 0.20 255)", nickname: "Nick" } },
      "c1",
      { color: "", nickname: "" },
    );
    expect(next.c1).toBeUndefined();
  });

  it("resolves display name and hero colour", () => {
    expect(getCourseDisplayName("Official", { nickname: "  Short  " })).toBe("Short");
    expect(getCourseHeroColor({ color: "oklch(0.56 0.20 255)" })).toBe("oklch(0.56 0.20 255)");
    expect(getCourseHeroColor({ color: "bad" })).toBeUndefined();
  });

  it("resolves accent from course id when no custom colour", () => {
    const accent = resolveCourseAccentColor("seed_course_cosc101");
    expect(accent).toMatch(/^oklch\(/);
  });

  it("uses the shared storage key", () => {
    writeCourseCardPreferences({ c1: { color: "oklch(0.56 0.18 145)" } });
    expect(localStorage.getItem(COURSE_CARD_PREFERENCES_KEY)).toContain("oklch");
  });
});
