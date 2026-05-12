import { z } from 'zod';

export const EduAiCourseSchema = z
  .object({
    id: z.string(),
    code: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    term: z.string().nullable().optional(),
    year: z.number().nullable().optional(),
    isActive: z.boolean().nullable().optional(),
    aiInstructions: z.string().nullable().optional(),
  })
  .passthrough();

export const EduAiCourseListSchema = z
  .object({
    courses: z.array(EduAiCourseSchema),
  })
  .passthrough();

export const EduAiTopicSchema = z
  .object({
    id: z.string(),
    courseId: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const EduAiTopicListSchema = z
  .object({
    topics: z.array(EduAiTopicSchema),
  })
  .passthrough();

export const EduAiEnrollmentSchema = z
  .object({
    id: z.string(),
    studentId: z.string(),
    studentEmail: z.string(),
    studentName: z.string(),
    enrolledAt: z.string(),
    isActive: z.boolean(),
  })
  .passthrough();

export const EduAiEnrollmentListSchema = z
  .object({
    enrollments: z.array(EduAiEnrollmentSchema),
  })
  .passthrough();
