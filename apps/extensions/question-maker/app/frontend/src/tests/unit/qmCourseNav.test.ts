/**
 * Unit tests for `buildQmCourseNav`: the shell's course menu for a QM course
 * workspace, which replaced the course page's tab bar.
 */
import { describe, expect, it } from "vitest";

import { buildQmCourseNav, courseIdFromPath } from "@/components/layout/qmCourseNav";
import type { Course } from "@/types/question";

const COURSE: Course = { id: 42, name: "Intro Biology", code: "BIOL 116", term: "W1", year: 2026 };

function build(
  pathname: string,
  { search = "", canvasLinked }: { search?: string; canvasLinked?: boolean | null } = {},
) {
  return buildQmCourseNav({ pathname, search, course: COURSE, canvasLinked });
}

describe("courseIdFromPath", () => {
  it.each([
    ["/courses/42", 42],
    ["/courses/42/banks/7", 42],
    ["/courses", null],
    ["/dashboard", null],
  ])("reads %s as %s", (path, expected) => {
    expect(courseIdFromPath(path)).toBe(expected);
  });
});

describe("buildQmCourseNav", () => {
  it("is undefined off the course workspace, or before the route's course loads", () => {
    expect(build("/dashboard")).toBeUndefined();
    expect(
      buildQmCourseNav({
        pathname: "/courses/42",
        search: "",
        course: undefined,
        canvasLinked: true,
      }),
    ).toBeUndefined();
    expect(
      buildQmCourseNav({
        pathname: "/courses/7",
        search: "",
        course: COURSE,
        canvasLinked: true,
      }),
    ).toBeUndefined();
  });

  it("lists the sections as ?tab= links with the course code and term", () => {
    const nav = build("/courses/42", { search: "?tab=questions" });
    expect(nav).toMatchObject({
      href: "/courses/42",
      code: "BIOL 116",
      term: "2026-27W1",
      activeKey: "questions",
    });
    expect(nav?.items.map((item) => item.href)).toEqual([
      "/courses/42?tab=overview",
      "/courses/42?tab=questions",
      "/courses/42?tab=banks",
      "/courses/42?tab=assessments",
    ]);
  });

  it("falls back to the course name when there is no code", () => {
    const nav = buildQmCourseNav({
      pathname: "/courses/42",
      search: "",
      course: { ...COURSE, code: null },
      canvasLinked: undefined,
    });
    expect(nav?.code).toBe("Intro Biology");
  });

  it.each([
    [true, true],
    [null, true],
    [false, false],
    [undefined, false],
  ])("with the Canvas link %s, lists Canvas: %s", (canvasLinked, listed) => {
    const keys = build("/courses/42", { canvasLinked })?.items.map((item) => item.key);
    expect(keys?.includes("canvas")).toBe(listed);
  });

  it("lands a Canvas link on Overview for an unlinked course", () => {
    expect(build("/courses/42", { search: "?tab=canvas", canvasLinked: false })?.activeKey).toBe(
      "overview",
    );
  });

  it.each([
    ["/courses/42/questions/new", "questions", "New question"],
    ["/courses/42/questions/9/edit", "questions", "Edit question"],
    ["/courses/42/questions/9/variant", "questions", "New variant"],
    ["/courses/42/assessments/5", "assessments", "Assessment builder"],
    ["/courses/42/assessments/5/variants", "assessments", "Variants"],
    ["/courses/42/banks/7", "banks", "Question bank"],
  ])("keeps %s under its %s section with a %s crumb", (path, section, subPage) => {
    expect(build(path)).toMatchObject({ activeKey: section, subPage });
  });
});
