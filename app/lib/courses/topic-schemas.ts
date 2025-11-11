import { z } from "zod"

export const CreateTopicSchema = z.object({
  name: z.string().min(1, "Topic name is required").max(100, "Topic name must be less than 100 characters"),
  description: z.string().optional(),
  categoryId: z.string().min(1, "Category ID is required"),
  order: z.number().int().min(0).optional().default(0),
})

export const UpdateTopicSchema = z.object({
  name: z.string().min(1, "Topic name is required").max(100, "Topic name must be less than 100 characters").optional(),
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
})

export type CreateTopicInput = z.infer<typeof CreateTopicSchema>
export type UpdateTopicInput = z.infer<typeof UpdateTopicSchema>
