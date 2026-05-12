import { z } from 'zod';

export const MCQOptionsSchema = z
  .union([z.array(z.string()), z.object({ choices: z.array(z.string()) })])
  .transform((v) => (Array.isArray(v) ? v : v.choices));

export const CreateActivitySchema = z.object({
  title: z.string().optional().nullable(),
  question: z.string().min(1),
  type: z.enum(['MCQ', 'SHORT_TEXT']).default('MCQ'),
  options: MCQOptionsSchema.nullish().transform((v) => v ?? null),
  answer: z.any().optional(),
  hints: z.array(z.string()).default([]),
  instructionsMd: z.string().optional(),
  promptTemplateId: z.number().int().nullable().optional(),
  customPrompt: z.string().optional().nullable(),
  customPromptTitle: z.string().max(20).optional().nullable(),
  mainTopicId: z.number().int(),
  secondaryTopicIds: z.array(z.number().int()).default([]),
  enableTeachMode: z.boolean().default(true),
  enableGuideMode: z.boolean().default(true),
  enableCustomMode: z.boolean().default(false),
});

export const UpdateActivitySchema = z.object({
  title: z.string().nullable().optional(),
  instructionsMd: z.string().optional(),
  question: z.string().min(1).optional(),
  type: z.enum(['MCQ', 'SHORT_TEXT']).optional(),
  options: MCQOptionsSchema.nullish()
    .transform((v) => v ?? null)
    .optional(),
  answer: z.any().optional(),
  hints: z.array(z.string()).optional(),
  promptTemplateId: z.number().int().nullable().optional(),
  customPrompt: z.string().optional().nullable(),
  customPromptTitle: z.string().max(20).optional().nullable(),
  mainTopicId: z.number().int().optional(),
  secondaryTopicIds: z.array(z.number().int()).optional(),
  enableTeachMode: z.boolean().optional(),
  enableGuideMode: z.boolean().optional(),
  enableCustomMode: z.boolean().optional(),
});

export default {
  MCQOptionsSchema,
  CreateActivitySchema,
  UpdateActivitySchema,
};
