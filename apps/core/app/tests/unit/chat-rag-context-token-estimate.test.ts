import { describe, it, expect } from "vitest";
import { ragContextTokenEstimateForCourseRagHits } from "~/routes/api/chat";
import type { HybridRagHit } from "~/lib/chat-rag";

function hit(content: string): HybridRagHit {
  return { content, similarity: 0.9, materialTitle: "test" };
}

describe("ragContextTokenEstimateForCourseRagHits", () => {
  it("returns 0 for no hits", () => {
    expect(ragContextTokenEstimateForCourseRagHits([])).toBe(0);
  });

  it("estimates chars/4, rounded up, per hit, then sums", () => {
    // "abcd" -> 4 chars -> ceil(4/4) = 1
    // "abcde" -> 5 chars -> ceil(5/4) = 2
    const hits = [hit("abcd"), hit("abcde")];
    expect(ragContextTokenEstimateForCourseRagHits(hits)).toBe(3);
  });

  it("matches the rule5 threshold's own expectations (>2000 with >=4 chunks)", () => {
    // 4 chunks of 600 chars each: ceil(600/4) = 150 tokens each = 600 total,
    // well under the 2000 threshold -- rule5 should NOT fire on this.
    const smallHits = Array.from({ length: 4 }, () => hit("x".repeat(600)));
    expect(ragContextTokenEstimateForCourseRagHits(smallHits)).toBeLessThan(2000);

    // 4 chunks of 3000 chars each: ceil(3000/4) = 750 tokens each = 3000
    // total, over the 2000 threshold -- rule5 SHOULD be eligible to fire.
    const largeHits = Array.from({ length: 4 }, () => hit("x".repeat(3000)));
    expect(ragContextTokenEstimateForCourseRagHits(largeHits)).toBeGreaterThan(2000);
  });
});
