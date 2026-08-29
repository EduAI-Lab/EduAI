/**
 * The breadcrumb switcher's primary label is the course code, which repeats
 * verbatim across every offering of a course. The term lives on the second line
 * so this term's course is distinguishable from last term's — in Core, AI Tutor
 * and Question Maker alike, which is why the helper lives in the shared package
 * rather than in any one app.
 */
import { describe, expect, it } from "vitest";
import { courseSwitcherSublabel } from "../lib/term";

describe("courseSwitcherSublabel", () => {
  it("pairs the name with the term so same-code offerings are distinguishable", () => {
    expect(
      courseSwitcherSublabel({
        code: "CPSC110",
        name: "Systematic Program Design",
        term: "W1",
        year: 2026,
      }),
    ).toBe("Systematic Program Design · 2026-27W1");
  });

  it("distinguishes two terms of the same course", () => {
    const base = { code: "CPSC110", name: "Systematic Program Design" };
    const winter = courseSwitcherSublabel({ ...base, term: "W1", year: 2026 });
    const summer = courseSwitcherSublabel({ ...base, term: "S1", year: 2026 });

    expect(winter).not.toBe(summer);
  });

  it("falls back to the name alone when the term is unknown", () => {
    expect(courseSwitcherSublabel({ code: "CPSC110", name: "Systematic Program Design" })).toBe(
      "Systematic Program Design",
    );
  });

  it("shows the term alone when there is no code, because the name is already the label", () => {
    expect(courseSwitcherSublabel({ name: "Ad-hoc course", term: "W1", year: 2026 })).toBe(
      "2026-27W1",
    );
  });

  it("returns undefined when neither a code nor a term is known", () => {
    expect(courseSwitcherSublabel({ name: "Ad-hoc course" })).toBeUndefined();
  });
});
