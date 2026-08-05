import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  matchPhase1Rules: vi.fn(),
  pickModelForSpec: vi.fn(),
  predictTierKnn: vi.fn(),
  classifyPromptForTier: vi.fn(),
  tierFromLlmClassification: vi.fn(),
}));

vi.mock("~/lib/ai/routing/rules", () => ({
  matchPhase1Rules: mocks.matchPhase1Rules,
}));

vi.mock("~/lib/ai/routing/tiers", () => ({
  pickModelForSpec: mocks.pickModelForSpec,
}));

vi.mock("~/lib/ai/routing/knn", () => ({
  predictTierKnn: mocks.predictTierKnn,
}));

vi.mock("~/lib/ai/routing/llm-classifier", () => ({
  classifyPromptForTier: mocks.classifyPromptForTier,
  tierFromLlmClassification: mocks.tierFromLlmClassification,
}));

vi.mock("~/lib/ai/routing/local-vllm", () => ({
  isLocalVllmRouting: () => false,
  normalizePickForLocalVllm: <T>(pick: T) => pick,
}));

import {
  resolveRoutedModelHybrid,
  resolveRoutedModelKnn,
  resolveRoutedModelLlm,
} from "~/lib/ai/routing/router";

const imageContext = { courseId: null, imagesPresent: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.matchPhase1Rules.mockReturnValue({
    rule: "rule6_default_tier_1_energy",
    pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
  });
  mocks.pickModelForSpec.mockImplementation(async (pick) => ({
    registryId: "vllm:qwen3.5-7b",
    tier: pick.kind === "exactTier" ? pick.tier : pick.minTier,
    routerTier: "TIER_1",
    estEnergyJoulesPerToken: 1,
    averageCarbonGramsPerToken: 1,
    supportsImages: true,
    supportsTools: true,
  }));
  mocks.predictTierKnn.mockResolvedValue({
    tier: 3,
    confidence: 0.9,
    neighbors: [],
    exemplarCount: 1,
  });
  mocks.classifyPromptForTier.mockResolvedValue({
    task: "chat",
    complexity: "high",
    confidence: 0.9,
  });
  mocks.tierFromLlmClassification.mockReturnValue(3);
});

describe("image inputs after retiring the image-routing rule", () => {
  it("lets kNN choose the tier for image inputs", async () => {
    const decision = await resolveRoutedModelKnn("describe this image", imageContext);

    expect(mocks.predictTierKnn).toHaveBeenCalledWith("describe this image");
    expect(decision.tier).toBe(3);
    expect(decision.features).toMatchObject({
      rule: "knn_tier_vote",
      pickSource: "knn",
      imagesPresent: true,
    });
  });

  it("lets confident hybrid routing choose the kNN tier for image inputs", async () => {
    const decision = await resolveRoutedModelHybrid("describe this image", imageContext);

    expect(mocks.predictTierKnn).toHaveBeenCalledWith("describe this image");
    expect(decision.tier).toBe(3);
    expect(decision.features).toMatchObject({
      rule: "hybrid_knn_tier",
      pickSource: "knn",
      imagesPresent: true,
    });
  });

  it("passes image context to the classifier without overriding its tier", async () => {
    const decision = await resolveRoutedModelLlm("describe this image", imageContext);

    expect(mocks.classifyPromptForTier).toHaveBeenCalledWith(
      "describe this image",
      imageContext,
    );
    expect(decision.tier).toBe(3);
    expect(decision.features).toMatchObject({
      rule: "llm_classifier",
      pickSource: "llm",
      imagesPresent: true,
    });
  });
});
