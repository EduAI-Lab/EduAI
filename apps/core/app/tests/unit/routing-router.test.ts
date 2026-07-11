import { afterEach, describe, expect, it, vi } from "vitest";

const predictTierKnn = vi.hoisted(() =>
  vi.fn(async () => ({
    tier: 3 as const,
    confidence: 0.6,
    neighbors: [],
    exemplarCount: 96,
  })),
);

vi.mock("~/lib/ai/routing/knn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai/routing/knn")>()),
  predictTierKnn,
}));

vi.mock("~/lib/ai/routing/tiers", () => ({
  pickModelForSpec: vi.fn(async (spec: { tier?: 1 | 2 | 3 }) => ({
    registryId: `test:tier-${spec.tier ?? 1}`,
    tier: spec.tier ?? 1,
    routerTier: `TIER_${spec.tier ?? 1}`,
    estEnergyJoulesPerToken: 1,
    averageCarbonGramsPerToken: 1,
    supportsImages: false,
    supportsTools: false,
  })),
}));

import { resolveRoutedModelHybrid } from "~/lib/ai/routing/router";

const context = {
  courseId: null,
  imagesPresent: false,
};

describe("resolveRoutedModelHybrid", () => {
  const originalMinSimilarity = process.env.ROUTING_KNN_MIN_SIM;

  afterEach(() => {
    if (originalMinSimilarity === undefined) {
      delete process.env.ROUTING_KNN_MIN_SIM;
    } else {
      process.env.ROUTING_KNN_MIN_SIM = originalMinSimilarity;
    }
  });

  it("uses the parsed default when minimum similarity is invalid", async () => {
    process.env.ROUTING_KNN_MIN_SIM = "not-a-number";

    const decision = await resolveRoutedModelHybrid(
      "Explain why this algorithm is correct.",
      context,
    );

    expect(decision.tier).toBe(3);
    expect(decision.features.rule).toBe("hybrid_knn_tier");
  });

  it("clamps an out-of-range minimum similarity before orchestration", async () => {
    process.env.ROUTING_KNN_MIN_SIM = "2";

    const decision = await resolveRoutedModelHybrid(
      "Explain why this algorithm is correct.",
      context,
    );

    expect(decision.features.pickSource).toBe("rules");
  });
});
