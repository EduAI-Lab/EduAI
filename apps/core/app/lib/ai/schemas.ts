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
  providerId: z.string().min(1, "Provider is required").optional(),
});

export type CreateAIProvider = z.infer<typeof CreateAIProviderSchema>;
export type UpdateAIProvider = z.infer<typeof UpdateAIProviderSchema>;
export type CreateAIModel = z.infer<typeof CreateAIModelSchema>;
export type UpdateAIModel = z.infer<typeof UpdateAIModelSchema>;