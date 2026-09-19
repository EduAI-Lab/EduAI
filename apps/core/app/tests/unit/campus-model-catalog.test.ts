import { describe, expect, it } from "vitest";
import {
  CAMPUS_INTERACTIVE_MODEL_IDS,
  DIRECT_ADDRESSED_MODEL_IDS,
  LEGACY_CAMPUS_MODEL_IDS,
  RETAINED_ASSIST_MODEL_ID,
} from "~/lib/ai/campus-model-catalog";
import {
  VLLM_MODELS,
  VLLM_RETIRED_MODEL_IDS,
  VLLM_ROUTING_TIER_ASSIGNMENTS,
} from "../../../prisma/ai-model-catalog";

describe("campus model catalog contract", () => {
  it("keeps a clean interactive catalog while isolating the retained Assist model", () => {
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).toEqual(["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"]);
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).not.toContain(RETAINED_ASSIST_MODEL_ID);
    expect(CAMPUS_INTERACTIVE_MODEL_IDS).not.toEqual(
      expect.arrayContaining([...LEGACY_CAMPUS_MODEL_IDS]),
    );
  });
});

/**
 * #1802: the declarative catalog (campus-model-catalog.ts) and the one the seed
 * and sync-ai-providers actually write (prisma/ai-model-catalog.ts) drifted a
 * full model generation apart, which left the models the fleet serves with no
 * active DB row. Neither file imports the other — they are read by different
 * runtimes — so agreement is enforced here instead.
 */
describe("seed catalog agrees with the declared campus catalog", () => {
  const seededIds = VLLM_MODELS.map((model) => model.modelId);

  it("seeds every declared interactive model", () => {
    for (const declared of CAMPUS_INTERACTIVE_MODEL_IDS) {
      expect(seededIds).toContain(declared);
    }
  });

  it("seeds the retained Assist model", () => {
    expect(seededIds).toContain(RETAINED_ASSIST_MODEL_ID);
  });

  it("seeds every directly-addressed model so its consumer can still resolve it", () => {
    // adhd-assist.ts and topics/completion.server.ts name these ids literally and
    // fail closed without an active catalog row (#1802).
    for (const direct of DIRECT_ADDRESSED_MODEL_IDS) {
      expect(seededIds).toContain(direct);
    }
  });

  it("never retires a model something still addresses directly", () => {
    for (const direct of DIRECT_ADDRESSED_MODEL_IDS) {
      expect(VLLM_RETIRED_MODEL_IDS).not.toContain(direct);
    }
  });

  it("seeds exactly the expected set — nothing extra, nothing missing", () => {
    expect([...seededIds].sort()).toEqual(
      [
        ...CAMPUS_INTERACTIVE_MODEL_IDS,
        RETAINED_ASSIST_MODEL_ID,
        ...DIRECT_ADDRESSED_MODEL_IDS,
      ].sort(),
    );
  });

  it("never seeds a model it also retires", () => {
    for (const retired of VLLM_RETIRED_MODEL_IDS) {
      expect(seededIds).not.toContain(retired);
    }
  });

  it("retires every model the campus catalog calls legacy", () => {
    for (const legacy of LEGACY_CAMPUS_MODEL_IDS) {
      expect(VLLM_RETIRED_MODEL_IDS).toContain(legacy);
    }
  });

  it("assigns a routing tier only to interactive models that are seeded", () => {
    for (const assignment of VLLM_ROUTING_TIER_ASSIGNMENTS) {
      expect(seededIds).toContain(assignment.modelId);
      expect(CAMPUS_INTERACTIVE_MODEL_IDS).toContain(
        assignment.modelId as (typeof CAMPUS_INTERACTIVE_MODEL_IDS)[number],
      );
    }
  });

  it("keeps the Assist model out of the Auto routing pool", () => {
    // Assist addresses this model directly; a routerTier would also enrol it in
    // tier routing, where it would compete with the interactive models.
    const tieredIds = VLLM_ROUTING_TIER_ASSIGNMENTS.map((a) => a.modelId);
    expect(tieredIds).not.toContain(RETAINED_ASSIST_MODEL_ID);
  });

  it("routes a small tier-1 and a large tier-3 model, as local-vLLM routing expects", () => {
    // lib/ai/routing/local-vllm.ts remaps every tier-2 pick to tier 3, so a
    // local deployment needs exactly these two tiers populated to route at all.
    const tiers = VLLM_ROUTING_TIER_ASSIGNMENTS.map((a) => a.routerTier);
    expect(tiers).toContain("TIER_1");
    expect(tiers).toContain("TIER_3");
  });
});
