import { describe, it, expect } from "vitest";
import { needsCourseRag } from "~/lib/ai/chat-intent";

describe("needsCourseRag", () => {
  it("returns false when no course is selected", () => {
    expect(needsCourseRag("What did chapter 3 say about trees?", false)).toBe(false);
  });

  it("returns false for S1-style generic knowledge (gradient descent)", () => {
    expect(needsCourseRag("What is gradient descent?", true)).toBe(false);
  });

  it("returns false for greetings", () => {
    expect(needsCourseRag("Hello!", true)).toBe(false);
    expect(needsCourseRag("Hi there", true)).toBe(false);
  });

  it("returns false for code requests", () => {
    expect(needsCourseRag("Write a Python function to sort a list", true)).toBe(false);
  });

  it("returns true for C1-style chapter questions", () => {
    expect(needsCourseRag("What did chapter 3 say about binary trees?", true)).toBe(true);
  });

  it("returns true for course material keywords", () => {
    expect(needsCourseRag("Summarize the lecture on recursion", true)).toBe(true);
    expect(needsCourseRag("What does the syllabus say about late assignments?", true)).toBe(true);
  });

  it("returns true for substantive questions when course is selected (borderline escalate)", () => {
    expect(needsCourseRag("Can you help me understand this concept from today?", true)).toBe(
      true,
    );
    expect(needsCourseRag("Who won the 2026 world cup?", true)).toBe(true);
  });

  it("returns false for empty messages", () => {
    expect(needsCourseRag("", true)).toBe(false);
    expect(needsCourseRag("   ", true)).toBe(false);
  });

  it("returns true when generic what-is includes course context", () => {
    expect(needsCourseRag("What is the course policy on collaboration?", true)).toBe(true);
  });

  it("returns false for short non-question chat", () => {
    expect(needsCourseRag("thanks", true)).toBe(false);
  });
});
