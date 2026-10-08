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
  it("pulls numbered graded items out of a question", () => {
    expect(extractCourseItemRefs("When is Lab 15 due, and what topic does it cover?")).toEqual([
      { kind: "lab", number: 15 },
    ]);
    expect(extractCourseItemRefs("Compare assignment #3 with Quiz no. 2")).toEqual([
      { kind: "assignment", number: 3 },
      { kind: "quiz", number: 2 },
    ]);
    expect(extractCourseItemRefs("Is HW3 harder than problem set 4?")).toEqual([
      { kind: "homework", number: 3 },
      { kind: "problem set", number: 4 },
    ]);
  });

  it("ignores unnumbered items and de-duplicates", () => {
    expect(extractCourseItemRefs("What is the lab about?")).toEqual([]);
    expect(extractCourseItemRefs("lab 4 vs Lab 04")).toEqual([{ kind: "lab", number: 4 }]);
  });

  it("does not read a weight, time, or section number as an item (PR #1946 review)", () => {
    expect(extractCourseItemRefs("Is the exam 40% of the grade?")).toEqual([]);
    expect(extractCourseItemRefs("Is the midterm 2pm or 4pm?")).toEqual([]);
    expect(extractCourseItemRefs("Is quiz 5 marks?")).toEqual([]);
    expect(extractCourseItemRefs("exam 3.2 heaps")).toEqual([]);
  });

  it("leaves content containers alone — their chunks rarely repeat the number", () => {
    expect(extractCourseItemRefs("Explain tidy data from lecture 14 and chapter 3")).toEqual([]);
  });
});

describe("findUncoveredCourseItemRefs", () => {
  it("flags a lab the excerpts never mention (#1936 Lab 15)", () => {
    const excerpts = [hit("Lab 14 is due Nov 20. Late penalty 7%/day."), hit("Tidy data")];
    expect(findUncoveredCourseItemRefs("When is Lab 15 due?", excerpts)).toEqual([
      { kind: "lab", number: 15 },
    ]);
  });

  it("accepts a lab the excerpts do mention", () => {
    const excerpts = [hit("Lab 14 is due Nov 20. Late penalty 7%/day.")];
    expect(findUncoveredCourseItemRefs("When is Lab 14 due?", excerpts)).toEqual([]);
    expect(findUncoveredCourseItemRefs("When is lab14 due?", [hit("LAB-14 due Nov 20")])).toEqual(
      [],
    );
  });

  it("accepts aliases and abbreviations (PR #1946 review)", () => {
    expect(findUncoveredCourseItemRefs("assignment 2?", [hit("A2 is due Friday", "x")])).toEqual(
      [],
    );
    expect(findUncoveredCourseItemRefs("homework 3?", [hit("HW3 covers joins", "x")])).toEqual([]);
    expect(findUncoveredCourseItemRefs("assignment 2?", [hit("Asg 2 rubric", "x")])).toEqual([]);
    expect(findUncoveredCourseItemRefs("lab 14?", [hit("tidy data", "Lab14_handout")])).toEqual([]);
  });

  it("counts a material title, including a one-letter abbreviation, as coverage", () => {
    const excerpts = [hit("Tidy data with melt() and pivot_longer()")];
    expect(findUncoveredCourseItemRefs("What does lab 14 ask?", excerpts)).toEqual([]);
    expect(
      findUncoveredCourseItemRefs("What does lab 15 ask?", excerpts).map((r) => r.number),
    ).toEqual([15]);
  });

  it("does not let a longer number satisfy a shorter one", () => {
    expect(findUncoveredCourseItemRefs("Lab 1 deadline?", [hit("Lab 14 due", "Notes")])).toEqual([
      { kind: "lab", number: 1 },
    ]);
  });
});

describe("resolveNoCoverageReason", () => {
  const base = { eligible: true, courseRagNeeded: true, isFollowUp: false };

  it("is null when the turn is not eligible or not a course question", () => {
    expect(
      resolveNoCoverageReason({ ...base, eligible: false, question: "x?", excerpts: [] }),
    ).toBe(null);
    expect(
      resolveNoCoverageReason({ ...base, courseRagNeeded: false, question: "hi", excerpts: [] }),
    ).toBe(null);
  });

  it("reports empty retrieval on the opening question", () => {
    expect(resolveNoCoverageReason({ ...base, question: "Is there a final?", excerpts: [] })).toBe(
      "no-hits",
    );
  });

  it("lets a follow-up with empty retrieval reach the model (PR #1946 review)", () => {
    for (const question of [
      "Continue the previous response from where it stopped. Do not repeat content already provided.",
      "Can you give an example of that?",
    ]) {
      expect(resolveNoCoverageReason({ ...base, isFollowUp: true, question, excerpts: [] })).toBe(
        null,
      );
    }
  });

  it("reports a named item the excerpts don't cover, even on a follow-up", () => {
    expect(
      resolveNoCoverageReason({
        ...base,
        isFollowUp: true,
        question: "And when is Lab 15 due?",
        excerpts: [hit("Lab 14 is due Nov 20.")],
      }),
    ).toBe("uncovered-item");
  });

  it("is null when the excerpts cover the question", () => {
    expect(
      resolveNoCoverageReason({
        ...base,
        question: "When is Lab 14 due?",
        excerpts: [hit("Lab 14 is due Nov 20.")],
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
