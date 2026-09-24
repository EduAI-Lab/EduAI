/**
 * Shared vLLM model catalog used by the reference seed and provider sync.
 *
 * The ids here MUST match `app/lib/ai/campus-model-catalog.ts`, which declares
 * what the release expects the fleet to serve. The two drifted a full model
 * generation apart once (#1802): this file still seeded the Qwen 2.5 pair and
 * listed the Qwen 3.5 models the fleet actually serves as *retired*, so a seed
 * or sync left `vllm:qwen3.5-2b-instruct` with no active catalog row and every
 * request for it failing 422. `campus-model-catalog.spec` now asserts the two
 * agree, so the same drift fails CI instead of the pilot.
 *
 * Ground truth for what is deployed: `infra/cmps01/migrate.sh` and
 * `infra/cmps02/migrate-qwen38.sh` (`--served-model-name`, `--max-model-len`).
 */

export const VLLM_MODELS = [
  {
    modelId: "qwen3.5-2b-instruct",
    name: "Qwen 3.5 2B (vLLM)",
    description: "House chat — tier 1, hybrid RAG",
    // cmps01 GPU 0 launches this without an explicit --max-model-len, so the
    // served window is whatever the model config says. Deliberately understated
    // here: overstating it makes chat pack more input than the server accepts
    // (a hard failure), while understating only makes the context digester in
    // CHAT_CONTEXT_FILL_RATIO start summarizing earlier. Raise once measured.
    maxTokens: 8192,
    supportsTools: false,
    supportsImages: false,
  },
  {
    modelId: "qwen3.5-9b-instruct",
    name: "Qwen 3.5 9B (vLLM)",
    description: "Large tier — tools via Hermes parser",
    maxTokens: 32768,
    supportsTools: true,
    supportsImages: false,
  },
  {
    modelId: "qwen3.8-27b-instruct",
    name: "Qwen 3.8 27B (vLLM)",
    description: "Assist Auto — cmps02 GPU 1; excluded from Auto routing",
    maxTokens: 65536,
    supportsTools: true,
    supportsImages: false,
  },
] as const;

/**
 * Energy and carbon figures are ESTIMATES, not measurements (#1802).
 *
 * Nothing in the codebase measures these — this seed is their only source — and
 * they feed both the sustainability estimate (`lib/ai/energy/estimate.server.ts`)
 * and the within-tier tie-break (`lib/ai/routing/tiers.ts:117-121`). The values
 * below are scaled linearly in parameter count from the retired Qwen 2.5 7B row
 * (0.08 J/token, 1.78e-6 gCO2/token).
 *
 * Treat them as order-of-magnitude only: the retired 32B row implied a steeper
 * curve than linear (0.5 J/token where linear scaling predicts 0.366), so the
 * real relation is not the one used here. Replace with measured values when the
 * fleet is instrumented. The tie-break is not sensitive to this today — one
 * model per routed tier — so the estimates affect reporting, not selection.
 *
 * The Assist model (qwen3.8-27b-instruct) is intentionally absent: it carries no
 * routerTier, because Assist Auto addresses it directly rather than through the
 * tier router, and a tiered row would put it in the Auto pool.
 */
export const VLLM_ROUTING_TIER_ASSIGNMENTS = [
  {
    providerName: "vllm",
    modelId: "qwen3.5-2b-instruct",
    routerTier: "TIER_1" as const,
    estEnergyJoulesPerToken: 0.023,
    averageCarbonGramsPerToken: 5.1e-7,
  },
  {
    providerName: "vllm",
    modelId: "qwen3.5-9b-instruct",
    routerTier: "TIER_3" as const,
    estEnergyJoulesPerToken: 0.103,
    averageCarbonGramsPerToken: 2.29e-6,
  },
] as const;

/**
 * IDs from prior fleet generations that this seed is allowed to retire.
 * cmps02 replaced `qwen2.5-32b-instruct` with `qwen3.8-27b-instruct`
 * (`infra/cmps02/migrate-qwen38.sh`).
 */
export const VLLM_RETIRED_MODEL_IDS = [
  "qwen2.5-7b-instruct",
  "qwen3.5-4b-instruct",
  "qwen2.5-32b-instruct",
] as const;
