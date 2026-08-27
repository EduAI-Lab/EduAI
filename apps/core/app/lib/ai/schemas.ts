import { z } from "zod";

// AI Provider Schemas
export const CreateAIProviderSchema = z.object({
  name: z.string().min(1, "Name is required"),
  displayName: z.string().min(1, "Display name is required"),
  description: z.string().min(1, "Description is required"),
  requiresApiKey: z.boolean().default(true),
  defaultBaseUrl: z.string().url("Must be a valid URL").optional(),
  envVarName: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const UpdateAIProviderSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  displayName: z.string().min(1, "Display name is required").optional(),
  description: z.string().min(1, "Description is required").optional(),
  requiresApiKey: z.boolean().optional(),
  defaultBaseUrl: z.string().url("Must be a valid URL").optional(),
  envVarName: z.string().optional(),
  isActive: z.boolean().optional(),
});

// A model must carry a `routerTier` to be eligible for Auto routing at all
// (see `apps/core/app/lib/ai/routing/tiers.ts` — `loadTierRows` filters on
// `routerTier: { not: null }`). `null` here means "not part of Auto's pool";
// it does not mean "unusable" — the model can still be picked explicitly.
//
// Tier 2 is effectively unreachable in a local-vLLM-only deployment
// (`VLLM_BASE_URL` set): `normalizePickForLocalVllm` in
// `apps/core/app/lib/ai/routing/local-vllm.ts` remaps every tier-2 pick to
// tier 3 before a model is chosen, and no rule in `routing/rules.ts` targets
// tier 2 directly either — it exists for a cloud-overflow tier that this
// deployment doesn't use. Tagging a model TIER_2 here is allowed (e.g. to
// document intent for a future cloud tier) but it will not receive Auto
// traffic under local-vLLM routing.
const RouterTierSchema = z.enum(["TIER_1", "TIER_2", "TIER_3"]).nullable();

// AI Model Schemas
export const CreateAIModelSchema = z.object({
  modelId: z.string().min(1, "Model ID is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  type: z.enum(["CHAT", "COMPLETION", "EMBEDDING", "IMAGE", "AUDIO", "VIDEO"]),
  maxTokens: z.number().int().min(1).optional(),
  supportsImages: z.boolean().default(false),
  supportsTools: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  inputPricing: z.number().min(0, "Input pricing must be non-negative").optional(),
  outputPricing: z.number().min(0, "Output pricing must be non-negative").optional(),
  isActive: z.boolean().default(true),
  routerTier: RouterTierSchema.optional(),
  providerId: z.string().min(1, "Provider is required"),
});

export const UpdateAIModelSchema = z.object({
  modelId: z.string().min(1, "Model ID is required").optional(),
  name: z.string().min(1, "Name is required").optional(),
  description: z.string().min(1, "Description is required").optional(),
  type: z.enum(["CHAT", "COMPLETION", "EMBEDDING", "IMAGE", "AUDIO", "VIDEO"]).optional(),
  maxTokens: z.number().int().min(1).optional(),
  supportsImages: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  inputPricing: z.number().min(0, "Input pricing must be non-negative").optional(),
  outputPricing: z.number().min(0, "Output pricing must be non-negative").optional(),
  isActive: z.boolean().optional(),
  routerTier: RouterTierSchema.optional(),
  providerId: z.string().min(1, "Provider is required").optional(),
});

export type CreateAIProvider = z.infer<typeof CreateAIProviderSchema>;
export type UpdateAIProvider = z.infer<typeof UpdateAIProviderSchema>;
export type CreateAIModel = z.infer<typeof CreateAIModelSchema>;
export type UpdateAIModel = z.infer<typeof UpdateAIModelSchema>;
