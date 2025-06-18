import { z } from "zod";

/**
 * Schema for creating a new course
 * - Requires a `name` field that is at least 2 characters long
 * - Used in POST /api/courses
 */

export const CreateCourseSchema = z.object({
  name: z.string().min(2, "Course name must be at least 2 characters long"),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(2).optional(),
});
