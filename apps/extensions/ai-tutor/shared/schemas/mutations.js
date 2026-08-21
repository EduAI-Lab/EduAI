import { z } from "zod";

const NumericIdSchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value) && value > 0, "Expected a positive integer");

const OptionalTextSchema = z.string().nullable().optional();

export const ExternalCourseImportSchema = z.object({
  externalCourseId: z.string().trim().min(1),
});

export const CourseContentImportSchema = z.object({
  sourceCourseId: NumericIdSchema.optional(),
  moduleIds: z.array(NumericIdSchema).optional(),
  lessonIds: z.array(NumericIdSchema).optional(),
  targetModuleId: NumericIdSchema.optional(),
});

export const CreateModuleSchema = z.object({
  title: z.string().min(1),
  description: OptionalTextSchema,
  position: z.number().int().optional(),
});

export const CreateLessonSchema = z.object({
  title: z.string().min(1),
  contentMd: OptionalTextSchema,
  position: z.number().int().optional(),
});

const UpdatePositionSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value), "Expected a number");

export const UpdateModuleSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: OptionalTextSchema,
    position: UpdatePositionSchema.optional(),
  })
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export const UpdateLessonSchema = z
  .object({
    title: z.string().min(1).optional(),
    contentMd: OptionalTextSchema,
    position: UpdatePositionSchema.optional(),
  })
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export const CreateTopicSchema = z.object({
  name: z.string().trim().min(1),
});

const TopicMappingSchema = z
  .object({
    fromTopicId: z.string().trim().min(1),
    toTopicId: z.string().trim().min(1),
  })
  .refine((mapping) => mapping.fromTopicId !== mapping.toTopicId, {
    message: "Source and target topics must differ",
  });

export const TopicRemapSchema = z.object({
  mappings: z.array(TopicMappingSchema).min(1),
});

const BugReportContextSchema = z
  .object({
    courseOfferingId: NumericIdSchema.nullish(),
    moduleId: NumericIdSchema.nullish(),
    lessonId: NumericIdSchema.nullish(),
    activityId: NumericIdSchema.nullish(),
  })
  .optional();

export const BugReportCreateSchema = z.object({
  description: z.string().trim().min(10).max(2000),
  bugType: z
    .enum([
      "UI_DISPLAY",
      "FEATURE_NOT_WORKING",
      "PERFORMANCE",
      "CONTENT_ERROR",
      "ACCESS_PERMISSION",
      "OTHER",
    ])
    .nullish(),
  consoleLogs: OptionalTextSchema,
  networkLogs: OptionalTextSchema,
  screenshot: OptionalTextSchema,
  pageUrl: OptionalTextSchema,
  userAgent: OptionalTextSchema,
  isAnonymous: z.boolean().optional(),
  context: BugReportContextSchema,
});

export const BugReportStatusUpdateSchema = z.object({
  status: z.enum(["unhandled", "in progress", "resolved"]),
});

export default {
  ExternalCourseImportSchema,
  CourseContentImportSchema,
  CreateModuleSchema,
  CreateLessonSchema,
  UpdateModuleSchema,
  UpdateLessonSchema,
  CreateTopicSchema,
  TopicRemapSchema,
  BugReportCreateSchema,
  BugReportStatusUpdateSchema,
};
