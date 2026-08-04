/**
 * Local vLLM-only routing — research stack uses tier 1 (7B) + tier 3 (32B) only.
 * Cloud tier-2 (Gemini) is excluded from Auto routing when VLLM is configured.
 */

import type { PickSpec } from "./tiers";

/** True when Auto routing should pick only `vllm:*` registry models. */
export function isLocalVllmRouting(): boolean {
  if (process.env.ROUTING_LOCAL_VLLM_ONLY === "1") {
    return true;
  }
  return Boolean(process.env.VLLM_BASE_URL?.trim());
}

/** Map legacy tier-2 (cloud overflow) picks to tier 3 (32B vLLM). */
export function normalizePickForLocalVllm(pick: PickSpec): PickSpec {
  if (!isLocalVllmRouting()) {
    return pick;
  }

  if (pick.kind === "exactTier" && pick.tier === 2) {
    return { ...pick, tier: 3 };
  }

  if (pick.kind === "minTier" && pick.minTier === 2) {
    return { ...pick, minTier: 3 };
  }

  return pick;
}

export function isVllmRegistryId(registryId: string): boolean {
  return registryId.startsWith("vllm:");
}
