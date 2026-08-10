// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aIModel: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  getCachedTierModels,
  invalidateTierModelCache,
  numToRouterTier,
  pickFromCandidates,
  pickModelForSpec,
  type TierModelRow,
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

  it("loads all providers' rows when local-vLLM-only routing is not active", async () => {
    delete process.env.VLLM_BASE_URL;
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-7b-instruct", "TIER_1"),
      { ...tierRow("gpt-4o-mini", "TIER_1"), provider: { name: "openai" } },
    ]);

    const rows = await getCachedTierModels();
    expect(rows.map((r) => r.registryId).sort()).toEqual([
      "openai:gpt-4o-mini",
      "vllm:qwen2.5-7b-instruct",
    ]);
  });
});

describe("numToRouterTier", () => {
  it("maps 1, 2, 3 to the corresponding RouterTier", () => {
    expect(numToRouterTier(1)).toBe("TIER_1");
    expect(numToRouterTier(2)).toBe("TIER_2");
    expect(numToRouterTier(3)).toBe("TIER_3");
  });

  it("returns null for an out-of-range number", () => {
    expect(numToRouterTier(4)).toBeNull();
    expect(numToRouterTier(0)).toBeNull();
  });
});

describe("pickFromCandidates", () => {
  function row(overrides: Partial<TierModelRow>): TierModelRow {
    return {
      registryId: "vllm:model",
      tier: 1,
      routerTier: "TIER_1",
      estEnergyJoulesPerToken: null,
      averageCarbonGramsPerToken: null,
      supportsImages: false,
      supportsTools: false,
      ...overrides,
    };
  }

  it("filters to an exact tier match", () => {
    const rows = [
      row({ registryId: "a", tier: 1 }),
      row({ registryId: "b", tier: 2 }),
      row({ registryId: "c", tier: 3 }),
    ];
    const picked = pickFromCandidates(rows, { kind: "exactTier", tier: 2, tieBreak: "energy" });
    expect(picked?.registryId).toBe("b");
  });

  it("filters to rows at or above a minimum tier", () => {
    const rows = [
      row({ registryId: "a", tier: 1, estEnergyJoulesPerToken: 1 }),
      row({ registryId: "b", tier: 2, estEnergyJoulesPerToken: 2 }),
      row({ registryId: "c", tier: 3, estEnergyJoulesPerToken: 3 }),
    ];
    const picked = pickFromCandidates(rows, { kind: "minTier", minTier: 2, tieBreak: "energy" });
    expect(picked?.registryId).toBe("b");
  });

  it("requires tool support when requireTools is set", () => {
    const rows = [
      row({ registryId: "no-tools", tier: 1, supportsTools: false }),
      row({ registryId: "has-tools", tier: 1, supportsTools: true }),
    ];
    const picked = pickFromCandidates(rows, {
      kind: "exactTier",
      tier: 1,
      requireTools: true,
      tieBreak: "energy",
    });
    expect(picked?.registryId).toBe("has-tools");
  });

  it("requires image support when requireImages is set", () => {
    const rows = [
      row({ registryId: "no-images", tier: 1, supportsImages: false }),
      row({ registryId: "has-images", tier: 1, supportsImages: true }),
    ];
    const picked = pickFromCandidates(rows, {
      kind: "exactTier",
      tier: 1,
      requireImages: true,
      tieBreak: "energy",
    });
    expect(picked?.registryId).toBe("has-images");
  });

  it("returns null when no candidates match the filters", () => {
    const rows = [row({ registryId: "a", tier: 1, supportsTools: false })];
    const picked = pickFromCandidates(rows, {
      kind: "minTier",
      minTier: 1,
      requireTools: true,
      tieBreak: "energy",
    });
    expect(picked).toBeNull();
  });

  it("breaks ties by carbon when tieBreak is carbon", () => {
    const rows = [
      row({ registryId: "high-carbon", tier: 1, averageCarbonGramsPerToken: 5 }),
      row({ registryId: "low-carbon", tier: 1, averageCarbonGramsPerToken: 1 }),
    ];
    const picked = pickFromCandidates(rows, { kind: "exactTier", tier: 1, tieBreak: "carbon" });
    expect(picked?.registryId).toBe("low-carbon");
  });

  it("treats a null tie-break metric as +Infinity, sorting it last", () => {
    const rows = [
      row({ registryId: "no-metric", tier: 1, estEnergyJoulesPerToken: null }),
      row({ registryId: "has-metric", tier: 1, estEnergyJoulesPerToken: 10 }),
    ];
    const picked = pickFromCandidates(rows, { kind: "exactTier", tier: 1, tieBreak: "energy" });
    expect(picked?.registryId).toBe("has-metric");
  });

  it("breaks equal-metric ties alphabetically by registryId", () => {
    const rows = [
      row({ registryId: "vllm:zeta", tier: 1, estEnergyJoulesPerToken: 5 }),
      row({ registryId: "vllm:alpha", tier: 1, estEnergyJoulesPerToken: 5 }),
    ];
    const picked = pickFromCandidates(rows, { kind: "exactTier", tier: 1, tieBreak: "energy" });
    expect(picked?.registryId).toBe("vllm:alpha");
  });
});

describe("pickModelForSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTierModelCache();
    process.env.VLLM_BASE_URL = "http://vllm.test";
  });

  afterEach(() => {
    delete process.env.VLLM_BASE_URL;
  });

  it("loads cached tier rows and picks a matching candidate", async () => {
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-32b-instruct", "TIER_3"),
    ]);

    const picked = await pickModelForSpec({ kind: "minTier", minTier: 3, tieBreak: "energy" });
    expect(picked?.registryId).toBe("vllm:qwen2.5-32b-instruct");
  });

  it("returns null when the cached rows have no match for the spec", async () => {
    prismaMock.aIModel.findMany.mockResolvedValueOnce([
      tierRow("qwen2.5-7b-instruct", "TIER_1"),
    ]);

    const picked = await pickModelForSpec({ kind: "exactTier", tier: 3, tieBreak: "energy" });
    expect(picked).toBeNull();
  });
});
