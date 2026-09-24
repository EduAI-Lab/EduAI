// @vitest-environment node
//
// Mirrors seed-routing-tiers.test.ts for sync-ai-providers.ts's own copy of
// the same tier-assignment/cleanup logic (#1802).
import { beforeEach, describe, expect, it, vi } from "vitest";

const aIProviderFindUnique = vi.fn();
const aIProviderUpsert = vi.fn();
const aIModelUpdateMany = vi.fn();
const aIModelUpsert = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    aIProvider = { findUnique: aIProviderFindUnique, upsert: aIProviderUpsert };
    aIModel = { updateMany: aIModelUpdateMany, upsert: aIModelUpsert };
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

const VLLM_PROVIDER = { id: "provider-vllm" };
const GOOGLE_PROVIDER = { id: "provider-google" };

function findUniqueByName(name: string) {
  if (name === "vllm") return VLLM_PROVIDER;
  if (name === "google") return GOOGLE_PROVIDER;
  return null;
}

function upsertByName({ where: { name } }: { where: { name: string } }) {
  const found = findUniqueByName(name);
  return Promise.resolve(found ?? { id: `provider-${name}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  aIProviderFindUnique.mockImplementation(({ where: { name } }: { where: { name: string } }) =>
    Promise.resolve(findUniqueByName(name)),
  );
  aIProviderUpsert.mockImplementation(upsertByName);
  aIModelUpdateMany.mockResolvedValue({ count: 1 });
  aIModelUpsert.mockResolvedValue({});
  // main() runs at import time and calls process.exit() on failure.
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

describe("sync-ai-providers.ts — applyRoutingTierAssignments", () => {
  it("clears and deactivates only known retired rows", async () => {
    await import("../../../prisma/sync-ai-providers");
    await vi.waitFor(() => expect(aIModelUpdateMany).toHaveBeenCalled());

    const { VLLM_RETIRED_MODEL_IDS } = await import("../../../prisma/ai-model-catalog");

    expect(aIModelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerId: VLLM_PROVIDER.id,
          // Scoped to still-tiered rows so an admin re-enable survives the next sync.
          routerTier: { not: null },
          modelId: { in: [...VLLM_RETIRED_MODEL_IDS] },
        }),
        data: { routerTier: null, isActive: false },
      }),
    );
  });

  it("clears a leftover tier on direct-addressed rows without deactivating them", async () => {
    await import("../../../prisma/sync-ai-providers");
    await vi.waitFor(() => expect(aIModelUpdateMany).toHaveBeenCalled());

    const { DIRECT_ADDRESSED_MODEL_IDS } = await import("~/lib/ai/campus-model-catalog");

    expect(aIModelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerId: VLLM_PROVIDER.id,
          routerTier: { not: null },
          modelId: { in: [...DIRECT_ADDRESSED_MODEL_IDS] },
        }),
        data: { routerTier: null },
      }),
    );
  });

  it("writes maxTokens and labels on every vLLM model upsert's update branch, not only on create", async () => {
    await import("../../../prisma/sync-ai-providers");
    await vi.waitFor(() => expect(aIModelUpsert).toHaveBeenCalled());

    const { VLLM_MODELS } = await import("../../../prisma/ai-model-catalog");

    for (const model of VLLM_MODELS) {
      expect(aIModelUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            providerId_modelId: {
              providerId: VLLM_PROVIDER.id,
              modelId: model.modelId,
            },
          },
          // Labels too, so an already-seeded row stops showing a stale tier description.
          update: expect.objectContaining({
            maxTokens: model.maxTokens,
            name: model.name,
            description: model.description,
          }),
        }),
      );
    }
  });
});
