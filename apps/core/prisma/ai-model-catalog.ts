/** Shared vLLM model catalog used by the reference seed and provider sync. */
export const VLLM_MODELS = [
  {
    modelId: "qwen2.5-7b-instruct",
    name: "Qwen 2.5 7B (vLLM)",
    description: "House chat — tier 1, hybrid RAG",
    maxTokens: 8192,
    supportsTools: false,
    supportsImages: false,
  },
  {
    modelId: "qwen2.5-32b-instruct",
    name: "Qwen 2.5 32B AWQ (vLLM)",
    description: "Large tier — tools via Hermes parser",
    maxTokens: 8192,
    supportsTools: true,
    supportsImages: false,
  },
] as const;

export const VLLM_ROUTING_TIER_ASSIGNMENTS = [
  {
    providerName: "vllm",
    modelId: "qwen2.5-7b-instruct",
    routerTier: "TIER_1" as const,
    estEnergyJoulesPerToken: 0.08,
    averageCarbonGramsPerToken: 1.78e-6,
  },
  {
    providerName: "vllm",
    modelId: "qwen2.5-32b-instruct",
    routerTier: "TIER_3" as const,
    estEnergyJoulesPerToken: 0.5,
    averageCarbonGramsPerToken: 1.11e-5,
  },
] as const;

/** IDs from the prior fleet generation that this seed is allowed to retire. */
export const VLLM_RETIRED_MODEL_IDS = ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] as const;
