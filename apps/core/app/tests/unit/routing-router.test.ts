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
  resolveRoutedModelRules,
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

describe("image inputs after retiring the dedicated image-routing rule (capability constraint still enforced centrally)", () => {
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

  it("requires supportsImages on every pick attempt (including the fallback) for image inputs, and never silently lands on a non-image-capable model", async () => {
    mocks.pickModelForSpec.mockImplementation(async (pick) => {
      // Simulate a pool where nothing in reach supports images (the seeded
      // local vLLM tiers default to supportsImages: false, per
      // prisma/seed.ts) — every pick attempt must ask for requireImages
      // and get refused rather than silently returning a text-only model.
      if (!pick.requireImages) {
        return {
          registryId: "vllm:qwen3.5-7b",
          tier: pick.kind === "exactTier" ? pick.tier : pick.minTier,
          routerTier: "TIER_1",
          estEnergyJoulesPerToken: 1,
          averageCarbonGramsPerToken: 1,
          supportsImages: false,
          supportsTools: true,
        };
      }
      return null;
    });

    await expect(resolveRoutedModelKnn("describe this image", imageContext)).rejects.toThrow(
      /image-capable model/i,
    );

    for (const call of mocks.pickModelForSpec.mock.calls) {
      expect(call[0]).toMatchObject({ requireImages: true });
    }
  });

  it("does not require supportsImages when no image is present", async () => {
    const decision = await resolveRoutedModelKnn("describe this text", {
      courseId: null,
      imagesPresent: false,
    });

    expect(decision.tier).toBe(3);
    for (const call of mocks.pickModelForSpec.mock.calls) {
      expect(call[0].requireImages).toBeFalsy();
    }
  });
});

describe("requireTools is preserved through the fallback pick (#1403 review)", () => {
  const toolsContext = { courseId: null, imagesPresent: false };

  it("carries requireTools into the fallback exactTier pick when the primary minTier pick fails", async () => {
    mocks.matchPhase1Rules.mockReturnValue({
      rule: "rule2_web_lookup_tools_tier_3",
      pick: { kind: "minTier", minTier: 3, requireTools: true, tieBreak: "carbon" },
    });

    mocks.pickModelForSpec.mockImplementation(async (pick) => {
      // Primary minTier pick (requireTools: true) fails — nothing tool-capable at
      // tier >= 3. The fallback exactTier attempt must still ask for requireTools
      // rather than silently accepting a tool-less model.
      if (pick.kind === "minTier") return null;
      if (pick.requireTools) return null;
      return {
        registryId: "vllm:qwen3.5-32b",
        tier: pick.tier,
        routerTier: "TIER_1",
        estEnergyJoulesPerToken: 1,
        averageCarbonGramsPerToken: 1,
        supportsImages: false,
        supportsTools: false,
      };
    });

    await expect(resolveRoutedModelRules("search the web please", toolsContext)).rejects.toThrow(
      /no active model/i,
    );

    // Every fallback attempt must have asked for requireTools: true — never
    // silently drop back to a tool-less tier.
    const fallbackCalls = mocks.pickModelForSpec.mock.calls.filter(
      ([pick]) => pick.kind === "exactTier",
    );
    expect(fallbackCalls.length).toBeGreaterThan(0);
    for (const [pick] of fallbackCalls) {
      expect(pick).toMatchObject({ requireTools: true });
    }
  });

  it("fallback succeeds with a tool-capable model when one exists at the fallback tier", async () => {
    mocks.matchPhase1Rules.mockReturnValue({
      rule: "rule2_web_lookup_tools_tier_3",
      pick: { kind: "minTier", minTier: 3, requireTools: true, tieBreak: "carbon" },
    });

    mocks.pickModelForSpec.mockImplementation(async (pick) => {
      if (pick.kind === "minTier") return null;
      if (pick.requireTools) {
        return {
          registryId: "vllm:qwen3.5-32b",
          tier: pick.tier,
          routerTier: "TIER_1",
          estEnergyJoulesPerToken: 1,
          averageCarbonGramsPerToken: 1,
          supportsImages: false,
          supportsTools: true,
        };
      }
      return null;
    });

    const decision = await resolveRoutedModelRules("search the web please", toolsContext);
    expect(decision.modelId).toBe("vllm:qwen3.5-32b");
    expect(decision.features.fallbackUsed).toBe(true);
  });

  it("does not require tools on the fallback when the primary pick didn't request them", async () => {
    mocks.matchPhase1Rules.mockReturnValue({
      rule: "rule6_default_tier_1_energy",
      pick: { kind: "exactTier", tier: 1, tieBreak: "energy" },
    });

    mocks.pickModelForSpec.mockResolvedValueOnce(null).mockResolvedValueOnce({
      registryId: "vllm:qwen3.5-7b",
      tier: 2,
      routerTier: "TIER_2",
      estEnergyJoulesPerToken: 1,
      averageCarbonGramsPerToken: 1,
      supportsImages: false,
      supportsTools: false,
    });

    const decision = await resolveRoutedModelRules("explain recursion", toolsContext);
    expect(decision.modelId).toBe("vllm:qwen3.5-7b");

    const fallbackCall = mocks.pickModelForSpec.mock.calls[1][0];
    expect(fallbackCall.requireTools).toBeUndefined();
  });
});
