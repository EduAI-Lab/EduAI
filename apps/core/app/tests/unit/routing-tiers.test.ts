// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aIModel: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getCachedTierModels,
  invalidateTierModelCache,
} from "~/lib/ai/routing/tiers";

const provider = { name: "vllm" };

function tierRow(modelId: string, routerTier: "TIER_1" | "TIER_3") {
  return {
    modelId,
    routerTier,
    estEnergyJoulesPerToken: null,
    averageCarbonGramsPerToken: null,
    supportsImages: false,
    supportsTools: true,
    provider,
  };
}

describe("routing tier model cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTierModelCache();
    process.env.VLLM_BASE_URL = "http://vllm.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VLLM_BASE_URL;
  });

  it("reloads active tier models after AI Management invalidates the cache", async () => {
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-7b-instruct", "TIER_1"),
    ]);
    expect((await getCachedTierModels())[0].registryId).toContain("7b");

    invalidateTierModelCache();
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-32b-instruct", "TIER_3"),
    ]);

    const refreshed = await getCachedTierModels();
    expect(refreshed.map((row) => row.registryId)).toEqual([
      "vllm:qwen2.5-32b-instruct",
    ]);
    expect(prismaMock.aIModel.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          provider: { isActive: true },
        }),
      }),
    );
  });

  it("reloads tier models after the cache TTL expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-7b-instruct", "TIER_1"),
    ]);
    expect((await getCachedTierModels())[0].registryId).toContain("7b");

    now.mockReturnValue(11_001);
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-32b-instruct", "TIER_3"),
    ]);

    expect((await getCachedTierModels())[0].registryId).toContain("32b");
    expect(prismaMock.aIModel.findMany).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("does not repopulate the cache from a load started before invalidation", async () => {
    let resolveStale!: (rows: ReturnType<typeof tierRow>[]) => void;
    const staleLoad = new Promise<ReturnType<typeof tierRow>[]>((resolve) => {
      resolveStale = resolve;
    });
    prismaMock.aIModel.findMany.mockReturnValueOnce(staleLoad);

    const firstRead = getCachedTierModels();
    invalidateTierModelCache();
    resolveStale([tierRow("qwen2.5-7b-instruct", "TIER_1")]);
    await firstRead;

    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-32b-instruct", "TIER_3"),
    ]);

    const refreshed = await getCachedTierModels();
    expect(refreshed.map((row) => row.registryId)).toEqual([
      "vllm:qwen2.5-32b-instruct",
    ]);
    expect(prismaMock.aIModel.findMany).toHaveBeenCalledTimes(2);
  });
});
