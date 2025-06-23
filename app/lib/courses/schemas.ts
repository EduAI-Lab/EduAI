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

