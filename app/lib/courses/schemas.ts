import { z } from "zod";

/**
 * Schema for creating a new course
 * - Used in POST /api/courses
 */

export const CreateCourseSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  term: z.string().min(1),
  year: z.number().int(),
  aiInstructions: z.string().optional().default(""),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  term: z.string().optional(),
  year: z.number().int().optional(),
  aiInstructions: z.string().optional(),
});

export const CreateCourseTopicSchema = z.object({
  name: z.string().min(1, "Topic name is required"),
  categoryId: z.string().min(1, "Category ID is required"),
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
export type DeleteCourseTopicInput = z.infer<typeof DeleteCourseTopicSchema>;

