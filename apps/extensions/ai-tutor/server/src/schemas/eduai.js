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
    // #1072 step 2: read-through source for CourseOffering.startDate/endDate.
    // Left as the raw JSON-serialized value (ISO string) rather than coerced
    // to `Date` — the single-course detail fetch (`fetchCoreCourseSafe`)
    // doesn't run through this schema at all, so coercing here would make
    // the field's type diverge between the list and detail read paths.
    startDate: z.union([z.string(), z.null()]).optional(),
    endDate: z.union([z.string(), z.null()]).optional(),
    // Present on `GET /api/courses` list rows only (Core computes it from the
    // caller's own enrollments); absent on the single-course detail fetch.
    callerEnrollmentRole: z.string().nullable().optional(),
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
