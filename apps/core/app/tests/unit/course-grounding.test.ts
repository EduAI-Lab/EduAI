import { describe, it, expect } from "vitest";

import {
  COURSE_MATERIALS_NO_COVERAGE_REPLY,
  extractCourseItemRefs,
  findUncoveredCourseItemRefs,
  ragSourceTitles,
  resolveNoCoverageReason,
} from "~/lib/ai/course-grounding";
import type { HybridRagHit } from "~/lib/chat-rag";

const hit = (
  content: string,
  materialTitle = "ZZ-TEST-DATA301-L14-Data-Cleaning",
): HybridRagHit => ({
  content,
  materialTitle,
  similarity: 0.7,
});

describe("extractCourseItemRefs", () => {
  it("pulls numbered course items out of a question", () => {
    expect(extractCourseItemRefs("When is Lab 15 due, and what topic does it cover?")).toEqual([
      { kind: "lab", number: 15 },
    ]);
    expect(extractCourseItemRefs("Compare assignment #3 with Quiz no. 2")).toEqual([
      { kind: "assignment", number: 3 },
      { kind: "quiz", number: 2 },
    ]);
  });

  it("ignores unnumbered items and de-duplicates", () => {
    expect(extractCourseItemRefs("What is the lab about?")).toEqual([]);
    expect(extractCourseItemRefs("lab 4 vs Lab 04")).toEqual([{ kind: "lab", number: 4 }]);
  });
});

describe("findUncoveredCourseItemRefs", () => {
  it("flags a lab the retrieved excerpts never mention (#1936 Lab 15)", () => {
    const hits = [hit("Lab 14 is due Nov 20. Late penalty 7%/day."), hit("Tidy data with melt()")];
    expect(findUncoveredCourseItemRefs("When is Lab 15 due?", hits)).toEqual([
      { kind: "lab", number: 15 },
    ]);
  });

  it("accepts a lab the excerpts do mention", () => {
    const hits = [hit("Lab 14 is due Nov 20. Late penalty 7%/day.")];
    expect(findUncoveredCourseItemRefs("When is Lab 14 due?", hits)).toEqual([]);
    expect(findUncoveredCourseItemRefs("When is lab14 due?", [hit("LAB-14 due Nov 20")])).toEqual(
      [],
    );
  });

  it("counts a material title, including its abbreviated form, as coverage", () => {
    // The first page of a lecture names it; later chunks of the same file don't.
    const hits = [hit("Tidy data with melt() and pivot_longer()")];
    expect(findUncoveredCourseItemRefs("Explain tidy data from lecture 14", hits)).toEqual([]);
    expect(
      findUncoveredCourseItemRefs("Explain tidy data from lecture 15", hits).map((r) => r.number),
    ).toEqual([15]);
  });

  it("accepts common abbreviations of the item word", () => {
    expect(findUncoveredCourseItemRefs("chapter 3 trees?", [hit("Trees.", "Ch 3")])).toEqual([]);
    expect(findUncoveredCourseItemRefs("chapter 3 trees?", [hit("See Ch. 3.", "Notes")])).toEqual(
      [],
    );
    expect(findUncoveredCourseItemRefs("lecture 14?", [hit("x", "Lec14_slides")])).toEqual([]);
    // One letter is only trusted in a title, not in body text.
    expect(findUncoveredCourseItemRefs("lab 3?", [hit("see L3", "Notes")])).toEqual([
      { kind: "lab", number: 3 },
    ]);
  });

  it("does not let a longer number satisfy a shorter one", () => {
    expect(findUncoveredCourseItemRefs("Lab 1 deadline?", [hit("Lab 14 due", "Notes")])).toEqual([
      { kind: "lab", number: 1 },
    ]);
  });
});

describe("resolveNoCoverageReason", () => {
  const eligible = { eligible: true, courseRagNeeded: true };

  it("is null when the turn is not eligible or not a course question", () => {
    expect(
      resolveNoCoverageReason({ ...eligible, eligible: false, question: "x?", hits: [] }),
    ).toBe(null);
    expect(
      resolveNoCoverageReason({ ...eligible, courseRagNeeded: false, question: "hi", hits: [] }),
    ).toBe(null);
  });

  it("reports empty retrieval", () => {
    expect(resolveNoCoverageReason({ ...eligible, question: "Is there a final?", hits: [] })).toBe(
      "no-hits",
    );
  });

  it("reports a named item the hits don't cover", () => {
    expect(
      resolveNoCoverageReason({
        ...eligible,
        question: "When is Lab 15 due?",
        hits: [hit("Lab 14 is due Nov 20.")],
      }),
    ).toBe("uncovered-item");
  });

  it("is null when the hits cover the question", () => {
    expect(
      resolveNoCoverageReason({
        ...eligible,
        question: "When is Lab 14 due?",
        hits: [hit("Lab 14 is due Nov 20.")],
      }),
    ).toBe(null);
  });
});

describe("ragSourceTitles", () => {
  it("lists each retrieved material once, in retrieval order", () => {
    expect(
      ragSourceTitles([hit("a", "301_1_Intro"), hit("b", "L14"), hit("c", "301_1_Intro")]),
    ).toEqual(["301_1_Intro", "L14"]);
  });

  it("drops blank titles", () => {
    expect(ragSourceTitles([hit("a", "  ")])).toEqual([]);
  });
});

it("no-coverage reply matches the issue's wording", () => {
  expect(COURSE_MATERIALS_NO_COVERAGE_REPLY).toBe(
    "The course materials don't cover this. Check Canvas or ask your instructor.",
  );
});
