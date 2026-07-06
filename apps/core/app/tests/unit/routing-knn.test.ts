import { describe, it, expect, vi, beforeEach } from "vitest";
import { cosineSimilarity } from "~/lib/ai/routing/cosine";
import {
  invalidateKnnExemplarCache,
  loadCachedKnnExemplars,
  voteTierFromNeighbors,
} from "~/lib/ai/routing/knn";

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() =>
    JSON.stringify({
      version: 1,
      exemplars: [
        { prompt: "define bit", tier: 1 },
        { prompt: "prove correctness", tier: 3, embedding: [1, 0] },
      ],
    }),
  ),
}));

vi.mock("node:fs", () => ({
  ...fsMock,
  default: fsMock,
}));

vi.mock("~/lib/ai/embedding", () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(async (prompts: string[]) =>
    prompts.map((_, i) => ({ embedding: [i, 1] })),
  ),
}));

import { generateEmbeddings } from "~/lib/ai/embedding";

beforeEach(() => {
  invalidateKnnExemplarCache();
  vi.clearAllMocks();
});

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

describe("loadCachedKnnExemplars", () => {
  it("embeds missing exemplar vectors on demand", async () => {
    const exemplars = await loadCachedKnnExemplars("/tmp/fake-exemplars.json");
    expect(generateEmbeddings).toHaveBeenCalledWith(["define bit"]);
    expect(exemplars).toHaveLength(2);
    expect(exemplars[0]?.embedding).toEqual([0, 1]);
    expect(exemplars[1]?.embedding).toEqual([1, 0]);
  });
});
