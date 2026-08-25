import { describe, expect, it } from "vitest";
import { courseSwitcherSublabel, dedupeCoursesByCoreId } from "@/utils/courseDisplay";
import { Course } from "@/types/question";

function course(partial: Partial<Course> & Pick<Course, "id" | "name">): Course {
  return {
    code: null,
    term: null,
    year: null,
    coreCourseId: null,
    userId: "u1",
    ...partial,
  };
}

describe("courseSwitcherSublabel", () => {
  it("pairs the name with the term so same-code courses are distinguishable", () => {
    expect(
      courseSwitcherSublabel(
        course({
          id: 1,
          code: "CPSC110",
          name: "Systematic Program Design",
          term: "W1",
          year: 2026,
        }),
      ),
    ).toBe("Systematic Program Design · 2026W1");
  });

  it("distinguishes two terms of the same course", () => {
    const winter = courseSwitcherSublabel(
      course({ id: 1, code: "CPSC110", name: "Systematic Program Design", term: "W1", year: 2026 }),
    );
    const summer = courseSwitcherSublabel(
      course({ id: 2, code: "CPSC110", name: "Systematic Program Design", term: "S1", year: 2026 }),
    );
    expect(winter).not.toBe(summer);
  });

  it("falls back to the name alone when the term is unknown", () => {
    expect(
      courseSwitcherSublabel(course({ id: 1, code: "CPSC110", name: "Systematic Program Design" })),
    ).toBe("Systematic Program Design");
  });

  it("shows the term alone when the course has no code (the name is already the label)", () => {
    expect(
      courseSwitcherSublabel(
        course({ id: 1, code: null, name: "Ad-hoc course", term: "W1", year: 2026 }),
      ),
    ).toBe("2026W1");
  });

  it("returns undefined when there is neither a code nor a term", () => {
    expect(
      courseSwitcherSublabel(course({ id: 1, code: null, name: "Ad-hoc course" })),
    ).toBeUndefined();
  });
});

describe("dedupeCoursesByCoreId", () => {
  it("collapses rows sharing the same coreCourseId to the newest id", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: "STUDY3", name: "Study 3 A", coreCourseId: "core-1" }),
      course({ id: 2, code: "STUDY3", name: "Study 3 B", coreCourseId: "core-1" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it("keeps unlinked rows separate even when codes match (#1072 §4 step 6 — no code identity)", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 1, code: "CPSC110", name: "Local mirror", coreCourseId: null }),
      course({ id: 2, code: "CPSC110", name: "Core linked", coreCourseId: "core-1" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps unlinked rows with empty codes separate by id", () => {
    const rows = dedupeCoursesByCoreId([
      course({ id: 10, code: null, name: "Orphan A" }),
      course({ id: 11, code: null, name: "Orphan B" }),
    ]);
    expect(rows).toHaveLength(2);
  });
});
