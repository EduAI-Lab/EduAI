import { z } from "zod";
import { UnitSchema } from "~/lib/units";

/**
 * Schema for creating a new course
 * - Used in POST /api/courses
 */

export const CreateCourseSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  section: z.string().min(1),
  term: z.string().min(1),
  year: z.number().int(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  // §19: department writes are validated against the canonical subject codes
  department: UnitSchema.optional(),
  description: z.string().optional(),
  isPublished: z.coerce.boolean().optional().default(false),
  aiInstructions: z.string().optional().default(""),
  instructorUserIds: z.array(z.string().min(1)).min(1),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  term: z.string().optional(),
  year: z.number().int().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  department: UnitSchema.optional().nullable(),
  description: z.string().optional().nullable(),
  isPublished: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  aiInstructions: z.string().optional(),
});

export const UpdateCourseRagSettingsSchema = z.object({
  ragTopK: z
    .number()
    .int()
    .min(1, "ragTopK must be at least 1")
    .max(20, "ragTopK must be at most 20")
    .nullable()
    .optional(),
  ragSimilarityThreshold: z
    .number()
    .gt(0, "ragSimilarityThreshold must be > 0")
    .lt(1, "ragSimilarityThreshold must be < 1")
    .nullable()
    .optional(),
});

export type UpdateCourseRagSettingsInput = z.infer<typeof UpdateCourseRagSettingsSchema>;

export const CreateCourseTopicSchema = z.object({
  name: z.string().min(1, "Topic name is required"),
});

export const UpdateCourseTopicSchema = z.object({
  name: z.string().min(1, "Topic name is required"),
});

export const DeleteCourseTopicSchema = z
  .object({
    topicId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .refine((data) => data.topicId || data.name, {
    message: "Provide topicId or name",
    path: ["topicId"],
  });

export type CreateCourseTopicInput = z.infer<typeof CreateCourseTopicSchema>;
export type UpdateCourseTopicInput = z.infer<typeof UpdateCourseTopicSchema>;
export type DeleteCourseTopicInput = z.infer<typeof DeleteCourseTopicSchema>;
