import { z } from "zod";
import { TERM_CODES } from "@eduai/ui/term";

/**
 * Schema for creating a new course
 * - Used in POST /api/courses
 */

// Canonical UBC term code — the single vocabulary shared across all EduAI apps.
const TermCodeSchema = z.enum(TERM_CODES);

export const CreateCourseSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  section: z.string().min(1),
  term: TermCodeSchema,
  year: z.number().int(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  // §19/§541: department is required; existence in the Discipline table is
  // validated server-side (see lib/courses/server.ts) and enforced by the FK.
  department: z.string().min(1),
  description: z.string().optional(),
  isPublished: z.coerce.boolean().optional().default(false),
  aiInstructions: z.string().optional().default(""),
  instructorUserIds: z.array(z.string().min(1)).min(1),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  term: TermCodeSchema.optional(),
  year: z.number().int().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  department: z.string().min(1).optional().nullable(),
  description: z.string().optional().nullable(),
  isPublished: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  aiInstructions: z.string().optional(),
  instructorId: z.string().min(1).optional(),
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

export const AddTASchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export const RemoveTASchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export type AddTAInput = z.infer<typeof AddTASchema>;
export type RemoveTAInput = z.infer<typeof RemoveTASchema>;

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
