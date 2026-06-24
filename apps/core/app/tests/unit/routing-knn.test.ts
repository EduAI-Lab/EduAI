import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "~/lib/ai/routing/cosine";
import { voteTierFromNeighbors } from "~/lib/ai/routing/knn";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("voteTierFromNeighbors", () => {
  it("picks tier with highest weighted vote", () => {
    const { tier } = voteTierFromNeighbors([
      { prompt: "a", tier: 1, similarity: 0.9 },
      { prompt: "b", tier: 2, similarity: 0.4 },
      { prompt: "c", tier: 1, similarity: 0.7 },
    ]);
    expect(tier).toBe(1);
  });

  it("defaults to tier 2 when empty", () => {
    const { tier, confidence } = voteTierFromNeighbors([]);
    expect(tier).toBe(2);
    expect(confidence).toBe(0);
  });
});
