import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isHybridRagAlwaysWithCourse,
  ragInjectModerateSimilarity,
  ragInjectStrongSimilarity,
  shouldInjectCourseRag,
  shouldPrefetchCourseRag,
} from "~/lib/ai/course-rag-policy";
import type { HybridRagHit } from "~/lib/chat-rag";

function hit(similarity: number): HybridRagHit {
  return { content: "chunk", similarity, materialTitle: "Lecture 1" };
}

describe("shouldPrefetchCourseRag", () => {
  it("prefetches when a course is selected", () => {
    expect(shouldPrefetchCourseRag(true)).toBe(true);
  });

  it("skips when no course is selected", () => {
    expect(shouldPrefetchCourseRag(false)).toBe(false);
  });
});

describe("shouldInjectCourseRag", () => {
  beforeEach(() => {
    delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
  });

  afterEach(() => {
    delete process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE;
  });

  it("returns false without a course", () => {
    expect(
      shouldInjectCourseRag({ hasCourse: false, courseRagNeeded: true, hits: [hit(0.9)] }),
    ).toBe(false);
  });

  it("returns true when needsCourseRag is true", () => {
    expect(
      shouldInjectCourseRag({ hasCourse: true, courseRagNeeded: true, hits: [] }),
    ).toBe(true);
  });

  it("returns false for greetings with weak hits", () => {
    expect(
      shouldInjectCourseRag({ hasCourse: true, courseRagNeeded: false, hits: [hit(0.3)] }),
    ).toBe(false);
  });

  it("returns true for strong similarity even when intent skips", () => {
    expect(
      shouldInjectCourseRag({
        hasCourse: true,
        courseRagNeeded: false,
        hits: [hit(ragInjectStrongSimilarity())],
      }),
    ).toBe(true);
  });

  it("returns true for moderate similarity with hits", () => {
    expect(
      shouldInjectCourseRag({
        hasCourse: true,
        courseRagNeeded: false,
        hits: [hit(ragInjectModerateSimilarity())],
      }),
    ).toBe(true);
  });

  it("honours CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE", () => {
    process.env.CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE = "1";
    expect(isHybridRagAlwaysWithCourse()).toBe(true);
    expect(
      shouldInjectCourseRag({ hasCourse: true, courseRagNeeded: false, hits: [] }),
    ).toBe(true);
  });
});
