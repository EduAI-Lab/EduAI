import { z } from 'zod';

export const KnowledgeLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);

function requiresUserApiKey(data) {
  if (data.modelId?.startsWith('openrouter:')) return true;
  return Boolean(data.apiKey?.trim());
}

const userApiKeyRefinement = {
  message: 'API key is required for this model',
  path: ['apiKey'],
};

export const TeachRequestSchema = z
  .object({
    knowledgeLevel: KnowledgeLevelSchema,
    topicId: z.number().int().optional(),
    message: z.string().min(1),
    modelId: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    chatId: z.string().min(1).nullable().optional(),
    messageId: z.string().min(1).optional(),
  })
  .refine(requiresUserApiKey, userApiKeyRefinement);

export const GuideRequestSchema = z
  .object({
    knowledgeLevel: KnowledgeLevelSchema,
    message: z.string().min(1),
    studentAnswer: z.union([z.string(), z.number()]).nullish(),
    modelId: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    chatId: z.string().min(1).nullable().optional(),
    messageId: z.string().min(1).optional(),
  })
  .refine(requiresUserApiKey, userApiKeyRefinement);

export const CustomRequestSchema = z
  .object({
    knowledgeLevel: KnowledgeLevelSchema,
    topicId: z.number().int().optional(),
    message: z.string().min(1),
    studentAnswer: z.union([z.string(), z.number()]).nullish(),
    modelId: z.string().min(1).optional(),
    apiKey: z.string().optional(),
    chatId: z.string().min(1).nullable().optional(),
    messageId: z.string().min(1).optional(),
  })
  .refine(requiresUserApiKey, userApiKeyRefinement);

export const ActivityFeedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export default {
  KnowledgeLevelSchema,
  TeachRequestSchema,
  GuideRequestSchema,
  CustomRequestSchema,
  ActivityFeedbackRequestSchema,
};
