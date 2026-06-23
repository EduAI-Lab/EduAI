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
    isPublished: z.boolean().nullable().optional(),
    aiInstructions: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
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

export const EduAiQuestionSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    difficulty: z.string(),
    content: z.string(),
    choices: z.array(z.object({ letter: z.string(), text: z.string() })).nullable().optional(),
    answer: z.string().nullable().optional(),
  })
  .passthrough();

export const EduAiQuestionListSchema = z
  .object({
    questions: z.array(EduAiQuestionSchema),
  })
  .passthrough();
