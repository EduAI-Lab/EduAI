import { describe, expect, it } from "vitest";

import {
  courseNavSearch,
  getCourseNavItems,
  resolveCourseNavKey,
} from "~/lib/courses/course-nav-items";
import type { PolicyKey } from "~/lib/policy-flags";

const allOn = () => true;
const allOff = () => false;
const only =
  (...keys: PolicyKey[]) =>
  (key: PolicyKey) =>
    keys.includes(key);

const keysOf = (items: ReturnType<typeof getCourseNavItems>) => items.map((item) => item.key);

describe("getCourseNavItems", () => {
  it("gives admins every section, enabled", () => {
    const items = getCourseNavItems("admin", allOff);
    expect(keysOf(items)).toEqual([
      "overview",
      "materials",
      "topics",
      "enrollments",
      "staff",
      "settings",
      "chat-history",
    ]);
    expect(items.every((item) => !item.disabled)).toBe(true);
    expect(items.find((item) => item.key === "staff")?.label).toBe("TAs");
  });

  it("greys out an instructor's TAs and Chat history while their policies are off (§807)", () => {
    const items = getCourseNavItems("instructor", allOff);
    expect(items.find((item) => item.key === "staff")?.disabled).toBe(true);
    expect(items.find((item) => item.key === "chat-history")?.disabled).toBe(true);
    expect(items.find((item) => item.key === "settings")?.disabled).toBeFalsy();
  });

  it("enables an instructor's TAs and Chat history when their policies are on", () => {
    const items = getCourseNavItems("instructor", allOn);
    expect(items.find((item) => item.key === "staff")?.disabled).toBe(false);
    expect(items.find((item) => item.key === "chat-history")?.disabled).toBe(false);
  });

  it("gives TAs Overview, Materials and Topics only — no Enrollments (§6)", () => {
    expect(keysOf(getCourseNavItems("ta", allOn))).toEqual(["overview", "materials", "topics"]);
  });

  it.each(["student", null] as const)("gives %s no course menu", (access) => {
    expect(getCourseNavItems(access, allOn)).toEqual([]);
  });
});

describe("resolveCourseNavKey", () => {
  const instructorItems = getCourseNavItems("instructor", only());

  it("selects an enabled section named by ?tab=", () => {
    expect(resolveCourseNavKey("materials", instructorItems)).toBe("materials");
  });

  it("falls back to Overview for a missing, unknown, or disabled section", () => {
    expect(resolveCourseNavKey(null, instructorItems)).toBe("overview");
    expect(resolveCourseNavKey("nope", instructorItems)).toBe("overview");
    expect(resolveCourseNavKey("staff", instructorItems)).toBe("overview");
  });

  it("falls back to Overview for a section the access level doesn't have", () => {
    expect(resolveCourseNavKey("enrollments", getCourseNavItems("ta", allOn))).toBe("overview");
  });
});

describe("courseNavSearch", () => {
  it("links Overview to the bare course URL and every other section by ?tab=", () => {
    expect(courseNavSearch("overview")).toBe("");
    expect(courseNavSearch("chat-history")).toBe("?tab=chat-history");
  });
});
