export type AIProvider = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  envVarName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  models?: AIModel[];
  _count: {
    models: number;
  };
};

export type RouterTier = "TIER_1" | "TIER_2" | "TIER_3";

export type AIModel = {
  id: string;
  modelId: string;
  name: string;
  description: string;
  type: "CHAT" | "COMPLETION" | "EMBEDDING" | "IMAGE" | "AUDIO" | "VIDEO";
  maxTokens?: number;
  supportsImages: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricing?: number;
  outputPricing?: number;
  isActive: boolean;
  // `null` = not part of Auto routing's candidate pool. See the comment on
  // `RouterTierSchema` in `~/lib/ai/schemas` for why TIER_2 is effectively
  // inert under local-vLLM routing.
  routerTier: RouterTier | null;
  createdAt: string;
  updatedAt: string;
  providerId: string;
  provider: Omit<AIProvider, "models" | "_count">;
};
