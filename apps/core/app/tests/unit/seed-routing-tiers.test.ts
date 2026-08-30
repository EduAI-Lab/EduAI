// @vitest-environment node
//
// Regression coverage for the seed's Auto-routing tier assignment/cleanup
// (review on #1680): a fresh `db:seed:reference` run must (1) tier the
// vLLM models this seed currently declares, using their real modelIds, and
// (2) clear routerTier off any vLLM row this seed no longer declares — e.g.
// a model left over from a previous fleet generation — so loadTierRows()
// (apps/core/app/lib/ai/routing/tiers.ts) cannot keep selecting a retired
// model just because an old tier assignment was never cleared.
import { beforeEach, describe, expect, it, vi } from "vitest";

const aIProviderFindUnique = vi.fn();
const aIModelUpdateMany = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    aIProvider = { findUnique: aIProviderFindUnique };
    aIModel = { updateMany: aIModelUpdateMany };
  },
  Prisma: {},
}));

// seed.ts pulls in a handful of server-only modules at import time; none of
// them touch the DB before `applyRoutingTierAssignments()` is invoked
// directly (real DB access is otherwise gated behind the `isMainModule`
// check at the bottom of the file), so importing the real module is safe
// once PrismaClient itself is mocked above.

const VLLM_PROVIDER = { id: "provider-vllm" };
const GOOGLE_PROVIDER = { id: "provider-google" };

function findUniqueByName(name: string) {
  if (name === "vllm") return VLLM_PROVIDER;
  if (name === "google") return GOOGLE_PROVIDER;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  aIProviderFindUnique.mockImplementation(({ where: { name } }: { where: { name: string } }) =>
    Promise.resolve(findUniqueByName(name)),
  );
  aIModelUpdateMany.mockResolvedValue({ count: 1 });
});

describe("seed.ts — applyRoutingTierAssignments", () => {
  it("tiers every currently-declared vLLM model by its real modelId", async () => {
    const { applyRoutingTierAssignments, ROUTING_TIER_ASSIGNMENTS } =
      await import("../../../prisma/seed");

    // Every assignment in the current catalog must match a real, non-empty
    // modelId — this is the exact failure mode the review flagged: a fresh
    // seed silently tiering zero rows because the assignment list drifted
    // from the vLLM catalog this same file upserts.
    expect(ROUTING_TIER_ASSIGNMENTS.length).toBeGreaterThan(0);
    for (const row of ROUTING_TIER_ASSIGNMENTS) {
      expect(row.modelId).toBeTruthy();
    }

    await applyRoutingTierAssignments();

    for (const row of ROUTING_TIER_ASSIGNMENTS) {
      expect(aIModelUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: VLLM_PROVIDER.id,
            modelId: row.modelId,
          }),
          data: expect.objectContaining({ routerTier: row.routerTier }),
        }),
      );
    }
  });

  it("clears only known retired rows and preserves admin-managed model rows", async () => {
    const { applyRoutingTierAssignments } = await import("../../../prisma/seed");

    await applyRoutingTierAssignments();

    const currentIds = ROUTING_TIER_ASSIGNMENTS.map((row) => row.modelId);
    expect(aIModelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerId: VLLM_PROVIDER.id,
          routerTier: { not: null },
          modelId: { in: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] },
        }),
        data: { routerTier: null },
      }),
    );

    const cleanup = aIModelUpdateMany.mock.calls.find(([args]) => args?.where?.modelId?.in)?.[0];
    expect(cleanup?.where?.modelId?.notIn).toBeUndefined();
  });

  it("also clears any leftover tier on Google rows", async () => {
    const { applyRoutingTierAssignments } = await import("../../../prisma/seed");

    await applyRoutingTierAssignments();

    expect(aIModelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerId: GOOGLE_PROVIDER.id,
          routerTier: { not: null },
        }),
        data: { routerTier: null },
      }),
    );
  });
});
