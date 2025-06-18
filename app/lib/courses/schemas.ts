import { z } from "zod";

export const CreateCourseSchema = z.object({
  name: z.string().min(2, "Course name must be at least 2 characters long"),
});

export const UpdateCourseSchema = z.object({
  name: z.string().min(2).optional(),
});
