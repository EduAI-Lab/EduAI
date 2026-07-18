import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  coalesceTokenUsage,
  normalizeTokenUsage,
  splitRegistryModelId,
} from "~/lib/ai/routing/telemetry";
import { persistAiInteractionTelemetry } from "~/lib/ai/routing/telemetry.server";
import { numToRouterTier, routerTierToNum } from "~/lib/ai/routing/tiers";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    aIModel: { findFirst: vi.fn() },
    aIInteraction: { create: vi.fn() },
  },
}));

vi.mock("~/lib/ai/energy/measurement.server", () => ({
  measureTurnEnergy: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import { measureTurnEnergy } from "~/lib/ai/energy/measurement.server";

describe("normalizeTokenUsage", () => {
  it("maps OpenAI-compatible snake_case fields", () => {
    expect(
      normalizeTokenUsage({
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
      }),
    ).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    });
  });

  it("treats all-zero usage as missing (vLLM stream without include_usage)", () => {
    expect(
      normalizeTokenUsage({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }),
    ).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it("coalesce skips zero-only sources", () => {
    expect(
      coalesceTokenUsage(
        { promptTokens: 0, completionTokens: 0 },
        { prompt_tokens: 10, completion_tokens: 5 },
      ),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("preserves total-only usage when prompt/completion are absent", () => {
    expect(normalizeTokenUsage({ total_tokens: 42 })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: 42,
    });
  });

  it("treats total_tokens: 0 as missing when split fields are present", () => {
    expect(
      normalizeTokenUsage({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 0,
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });
});

describe("splitRegistryModelId", () => {
  it("parses provider:model", () => {
    expect(splitRegistryModelId("openai:gpt-4")).toEqual({
      providerName: "openai",
      modelId: "gpt-4",
    });
  });

  it("returns null with no colon", () => {
    expect(splitRegistryModelId("gpt-4")).toBeNull();
  });

  it("returns null for empty segments", () => {
    expect(splitRegistryModelId(":model")).toBeNull();
    expect(splitRegistryModelId("provider:")).toBeNull();
  });
});

describe("router tier helpers", () => {
  it("round-trips tier numbers", () => {
    expect(routerTierToNum("TIER_1")).toBe(1);
    expect(routerTierToNum("TIER_2")).toBe(2);
    expect(routerTierToNum("TIER_3")).toBe(3);
    expect(numToRouterTier(1)).toBe("TIER_1");
    expect(numToRouterTier(2)).toBe("TIER_2");
    expect(numToRouterTier(3)).toBe("TIER_3");
    expect(numToRouterTier(9)).toBeNull();
  });
});

describe("persistAiInteractionTelemetry", () => {
  const baseParams = {
    userId: "user-1",
    courseId: null,
    resolvedModelId: "openai:gpt-4",
    query: "hello",
    responseText: "hi",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: "stop",
    durationMs: 100,
    wasAuto: false,
    routingTier: null,
    routerVersion: null,
    routerFeatures: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.aIModel.findFirst).mockResolvedValue(null);
    vi.mocked(measureTurnEnergy).mockResolvedValue({
      energyJoules: 1.5,
      carbonGramsCO2: 0.1,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
    vi.mocked(prisma.aIInteraction.create).mockResolvedValue({ id: "ix-1" } as never);
  });

  it("persists totalTokens alongside prompt/completion counts", async () => {
    await persistAiInteractionTelemetry(baseParams);

    expect(prisma.aIInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        }),
      }),
    );
  });

  it("swallows DB errors without throwing", async () => {
    vi.mocked(prisma.aIInteraction.create).mockRejectedValue(new Error("DB down"));

    await expect(persistAiInteractionTelemetry(baseParams)).resolves.toBeUndefined();
  });
});
