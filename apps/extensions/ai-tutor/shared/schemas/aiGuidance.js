import { z } from "zod";

export const KnowledgeLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);

/**
 * `Topic.id` is a cuid string (`Topic.id String @id @default(cuid())`), and
 * `resolveTopicName` compares the incoming id against `mainTopic.id` and the
 * join rows' `topicId`, both cuids. This was declared `z.number().int()`, so a
 * real topic id was rejected at the boundary and the focus-topic selection
 * never reached the tutor prompt.
 */
export const TopicIdSchema = z.string().min(1);

export const TeachRequestSchema = z.object({
  knowledgeLevel: KnowledgeLevelSchema,
  topicId: TopicIdSchema.optional(),
  message: z.string().min(1),
  modelId: z.string().min(1).optional(),
  apiKey: z.string().min(1),
  apiKeys: z.record(z.string().min(1).max(512)).optional(),
  supervisorApiKey: z.string().min(1).max(512).optional(),
  chatId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).optional(),
});

export const GuideRequestSchema = z.object({
  knowledgeLevel: KnowledgeLevelSchema,
  message: z.string().min(1),
  studentAnswer: z.union([z.string(), z.number()]).nullish(),
  modelId: z.string().min(1).optional(),
  apiKey: z.string().min(1),
  apiKeys: z.record(z.string().min(1).max(512)).optional(),
  supervisorApiKey: z.string().min(1).max(512).optional(),
  chatId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).optional(),
});

export const CustomRequestSchema = z.object({
  knowledgeLevel: KnowledgeLevelSchema,
  topicId: TopicIdSchema.optional(),
  message: z.string().min(1),
  studentAnswer: z.union([z.string(), z.number()]).nullish(),
  modelId: z.string().min(1).optional(),
  apiKey: z.string().min(1),
  apiKeys: z.record(z.string().min(1).max(512)).optional(),
  supervisorApiKey: z.string().min(1).max(512).optional(),
  chatId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).optional(),
});

export const ActivityFeedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export default {
  KnowledgeLevelSchema,
  TeachRequestSchema,
  GuideRequestSchema,
  CustomRequestSchema,
  ActivityFeedbackRequestSchema,
};
