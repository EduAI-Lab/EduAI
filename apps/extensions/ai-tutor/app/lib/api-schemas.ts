import { z } from "zod";

import type { AiServiceStatusPair, ServiceStatus } from "@eduai/ui";

import type {
  Activity,
  ActivityAnalyticsRow,
  ActivityAnswerResult,
  ActivityFeedbackResult,
  ActivityFeedbackRow,
  AdminBugReportRow,
  AdminEnrollmentData,
  AdminUser,
  AdminUserPage,
  AiModel,
  Course,
  EduAiApiKeyStatus,
  EnrolledStudent,
  Lesson,
  Module,
  Progress,
  StudentMetricRow,
  SubmissionRow,
  SuggestedPrompt,
  Topic,
  User,
} from "~/lib/types";

/**
 * Response contracts for the AT backend, one schema per shape `api.ts` reads.
 *
 * These exist because a `Promise<Course>` annotation on a `fetch` result is a
 * claim, not a check: nothing stopped the backend from renaming a field. Each
 * schema is declared `satisfies z.ZodType<T>` against the hand-written type in
 * `~/lib/types`, so the compiler proves the two agree and the parse proves the
 * payload does. Objects are `passthrough` — a field the UI does not read yet is
 * not a reason to reject a response.
 */

const roleSchema = z.union([
  z.literal("ADMIN"),
  z.literal("UNIT_ADMIN"),
  z.literal("INSTRUCTOR"),
  z.literal("STUDENT"),
  z.literal("TA"),
]);

const enrollmentRoleSchema = z.union([
  z.literal("STUDENT"),
  z.literal("TA"),
  z.literal("INSTRUCTOR"),
]);

const costTierSchema = z.union([z.literal("LOW"), z.literal("MEDIUM"), z.literal("HIGH")]);

const bugReportStatusSchema = z.union([
  z.literal("unhandled"),
  z.literal("in progress"),
  z.literal("resolved"),
]);

const bugReportTypeSchema = z.union([
  z.literal("UI_DISPLAY"),
  z.literal("FEATURE_NOT_WORKING"),
  z.literal("PERFORMANCE"),
  z.literal("CONTENT_ERROR"),
  z.literal("ACCESS_PERMISSION"),
  z.literal("OTHER"),
]);

const activityTypeSchema = z.union([z.literal("MCQ"), z.literal("SHORT_TEXT")]);

const completionStatusSchema = z.union([
  z.literal("correct"),
  z.literal("incorrect"),
  z.literal("not_attempted"),
]);

export const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    authorizedUnits: z.array(z.string()).optional(),
  })
  .passthrough() satisfies z.ZodType<User>;

export const meSchema = z.object({ user: userSchema.nullable() }).passthrough();

/**
 * One AI service's health, as `@eduai/ui`'s header chips read it. The AT route
 * proxies Core's probe verbatim, so the states are Core's, not AT's.
 */
const serviceStatusSchema = z
  .object({
    state: z.union([
      z.literal("operational"),
      z.literal("degraded"),
      z.literal("outage"),
      z.literal("loading"),
      z.literal("unknown"),
    ]),
    detail: z.string().optional(),
  })
  .passthrough() satisfies z.ZodType<ServiceStatus>;

export const aiStatusSchema = z
  .object({
    cloud: serviceStatusSchema,
    ubc: serviceStatusSchema,
  })
  .passthrough() satisfies z.ZodType<AiServiceStatusPair>;

const progressSchema = z
  .object({
    completed: z.number(),
    total: z.number(),
    percentage: z.number(),
  })
  .passthrough() satisfies z.ZodType<Progress>;

export const courseSchema = z
  .object({
    id: z.number(),
    coreOfferingId: z.string().nullish(),
    title: z.string().nullable(),
    code: z.string().nullish(),
    description: z.string().nullish(),
    department: z.string().nullish(),
    isPublished: z.boolean(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    term: z.string().nullish(),
    year: z.number().nullish(),
    aiInstructions: z.string().nullish(),
    corePublishStale: z.boolean().optional(),
    progress: progressSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<Course>;

export const moduleSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullish(),
    position: z.number(),
    isPublished: z.boolean(),
    progress: progressSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<Module>;

export const lessonSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    contentMd: z.string().nullish(),
    position: z.number(),
    isPublished: z.boolean(),
    courseOfferingId: z.number().optional(),
    moduleId: z.number().optional(),
    progress: progressSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<Lesson>;

/** Topic ids are cuid strings on the wire; the number arm covers legacy fixtures. */
export const topicSchema = z
  .object({ id: z.union([z.string(), z.number()]), name: z.string() })
  .passthrough() satisfies z.ZodType<Topic>;

export const activitySchema = z
  .object({
    id: z.number(),
    title: z.string().nullish(),
    instructionsMd: z.string(),
    position: z.number(),
    question: z.string(),
    type: activityTypeSchema,
    options: z
      .object({ choices: z.array(z.string()).optional() })
      .passthrough()
      .nullable(),
    answer: z.any(),
    hints: z.array(z.string()),
    promptTemplateId: z.number().nullish(),
    promptTemplate: z.object({ id: z.number(), name: z.string() }).passthrough().nullish(),
    mainTopic: topicSchema.nullable(),
    secondaryTopics: z.array(topicSchema),
    enableTeachMode: z.boolean(),
    enableGuideMode: z.boolean(),
    enableCustomMode: z.boolean(),
    customPrompt: z.string().nullable(),
    customPromptTitle: z.string().nullable(),
    completionStatus: completionStatusSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<Activity>;

export const aiModelSchema = z
  .object({
    id: z.string(),
    modelId: z.string(),
    modelName: z.string(),
    provider: z.string().nullish(),
    summary: z.string().nullish(),
    costTier: costTierSchema.nullish(),
    roleHint: z.string().nullish(),
    studentSelectable: z.boolean().optional(),
    availability: z
      .union([z.literal("allowed"), z.literal("admin-only"), z.literal("blocked")])
      .optional(),
    isDefaultTutor: z.boolean().optional(),
  })
  .passthrough() satisfies z.ZodType<AiModel>;

export const suggestedPromptSchema = z
  .object({
    id: z.number(),
    mode: z.union([z.literal("teach"), z.literal("guide")]),
    text: z.string(),
  })
  .passthrough() satisfies z.ZodType<SuggestedPrompt>;

export const eduAiApiKeyStatusSchema = z
  .object({
    configured: z.boolean(),
    source: z.union([z.literal("ADMIN"), z.literal("ENV"), z.literal("NONE")]),
    hasAdminOverride: z.boolean(),
    envConfigured: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .passthrough() satisfies z.ZodType<EduAiApiKeyStatus>;

const submissionResponseSchema = z
  .object({
    answerText: z.string().nullish(),
    answerOption: z.number().nullish(),
  })
  .passthrough();

export const submissionRowSchema = z
  .object({
    id: z.number(),
    userId: z.string(),
    studentName: z.string().nullish(),
    activityId: z.number(),
    activityTitle: z.string().nullish(),
    lessonTitle: z.string().nullish(),
    questionText: z.string().nullish(),
    attemptNumber: z.number(),
    response: submissionResponseSchema.nullish(),
    answerLabel: z.string().nullish(),
    aiFeedback: z.object({ message: z.string().nullish() }).passthrough().nullish(),
    score: z.number().nullish(),
    isCorrect: z.boolean().nullish(),
    createdAt: z.string(),
  })
  .passthrough() satisfies z.ZodType<SubmissionRow>;

export const gradedSubmissionSchema = submissionRowSchema.extend({
  score: z.number().nullish(),
  feedback: z.string().nullish(),
});

export const activityFeedbackRowSchema = z
  .object({
    id: z.number(),
    userId: z.string(),
    activityId: z.number(),
    rating: z.number(),
    note: z.string().nullish(),
    createdAt: z.string(),
  })
  .passthrough() satisfies z.ZodType<ActivityFeedbackRow>;

export const studentMetricRowSchema = z
  .object({
    userId: z.string(),
    submissionCount: z.number(),
    correctSubmissionCount: z.number(),
    incorrectSubmissionCount: z.number(),
    helpRequestCount: z.number(),
  })
  .passthrough() satisfies z.ZodType<StudentMetricRow>;

export const activityAnalyticsRowSchema = z
  .object({
    activityId: z.number(),
    averageRating: z.number().nullish(),
    feedbackCount: z.number().optional(),
    difficultyScore: z.string().nullish(),
    activity: z
      .object({
        id: z.number(),
        title: z.string().nullish(),
        lessonId: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough() satisfies z.ZodType<ActivityAnalyticsRow>;

const adminUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: roleSchema,
    createdAt: z.string(),
  })
  .passthrough() satisfies z.ZodType<AdminUser>;

/**
 * An enrolled student's `role` is the course-side role, which is also the part
 * of the platform `Role` union that `EnrolledStudent` narrows to.
 */
const enrolledStudentSchema = adminUserSchema
  .extend({ role: enrollmentRoleSchema })
  .passthrough() satisfies z.ZodType<EnrolledStudent>;

export const adminUserPageSchema = z
  .object({
    data: z.array(adminUserSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    stats: z
      .object({
        total: z.number(),
        active: z.number(),
        byRole: z.record(z.string(), z.number()),
      })
      .passthrough(),
  })
  .passthrough() satisfies z.ZodType<AdminUserPage>;

export const adminEnrollmentDataSchema = z
  .object({
    courseId: z.number(),
    enrolledStudents: z.array(enrolledStudentSchema),
    availableStudents: z.array(adminUserSchema),
    availableStudentsPage: z
      .object({ total: z.number(), page: z.number(), pageSize: z.number() })
      .passthrough(),
  })
  .passthrough() satisfies z.ZodType<AdminEnrollmentData>;

export const adminBugReportRowSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    bugType: bugReportTypeSchema.nullish(),
    status: bugReportStatusSchema,
    consoleLogs: z.string().nullish(),
    networkLogs: z.string().nullish(),
    screenshot: z.string().nullish(),
    hasConsoleLogs: z.boolean().optional(),
    hasNetworkLogs: z.boolean().optional(),
    hasScreenshot: z.boolean().optional(),
    pageUrl: z.string().nullish(),
    userAgent: z.string().nullish(),
    isAnonymous: z.boolean(),
    userId: z.string(),
    reporterName: z.string().nullish(),
    reporterEmail: z.string().nullish(),
    reporterRole: roleSchema.nullish(),
    user: z
      .object({
        id: z.string(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        role: roleSchema.nullable(),
      })
      .passthrough()
      .nullish(),
    userName: z.string().nullish(),
    userEmail: z.string().nullish(),
    role: roleSchema.nullish(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    courseOfferingId: z.number().nullish(),
    moduleId: z.number().nullish(),
    lessonId: z.number().nullish(),
    activityId: z.number().nullish(),
    courseTitle: z.string().nullish(),
    moduleTitle: z.string().nullish(),
    lessonTitle: z.string().nullish(),
    activityTitle: z.string().nullish(),
  })
  .passthrough() satisfies z.ZodType<AdminBugReportRow>;

export const activityAnswerResultSchema = z
  .object({
    ok: z.boolean(),
    isCorrect: z.boolean().nullable(),
    message: z.string(),
    submissionId: z.number().optional(),
    feedbackRequired: z.boolean().optional(),
    feedbackAlreadySubmitted: z.boolean().optional(),
  })
  .passthrough() satisfies z.ZodType<ActivityAnswerResult>;

export const activityFeedbackResultSchema = z
  .object({
    ok: z.boolean(),
    feedback: z
      .object({
        id: z.number(),
        rating: z.number(),
        note: z.string().nullable(),
        createdAt: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough() satisfies z.ZodType<ActivityFeedbackResult>;

export const courseFacetsSchema = z
  .object({
    terms: z.array(z.string()),
    statuses: z.array(z.string()),
    progress: z.array(z.string()),
    coreUnavailable: z.boolean(),
  })
  .passthrough();

export const importableActivitySchema = z
  .object({
    id: z.number(),
    title: z.string().nullish(),
    question: z.string(),
    type: activityTypeSchema.optional(),
    lessonId: z.number().optional(),
    lessonTitle: z.string().nullish(),
    moduleTitle: z.string().nullish(),
    courseId: z.number().optional(),
    courseTitle: z.string().nullish(),
  })
  .passthrough();

export const dashboardStatsSchema = z
  .object({
    enrolledCourses: z.number().optional(),
    coursesInProgress: z.number().optional(),
    coursesCompleted: z.number().optional(),
    yourCourses: z.number().optional(),
    publishedCourses: z.number().optional(),
    draftCourses: z.number().optional(),
    syncedCourses: z.number().optional(),
    totalUsers: z.number().optional(),
    totalCourses: z.number().optional(),
    openBugReports: z.number().optional(),
    totalBugReports: z.number().optional(),
    pendingSubmissions: z.number().optional(),
  })
  .passthrough();

export const aiTraceRowSchema = z
  .object({
    id: z.number(),
    mode: z.string().nullish(),
    knowledgeLevel: z.string().nullish(),
    tutorModelId: z.string().nullish(),
    supervisorModelId: z.string().nullish(),
    iterationCount: z.number().nullish(),
    finalOutcome: z.string().nullish(),
    createdAt: z.string().optional(),
    user: z.object({ id: z.string(), name: z.string().nullish() }).passthrough().nullish(),
    activity: z.object({ id: z.number(), title: z.string().nullish() }).passthrough().nullish(),
    courseId: z.number().nullish(),
    courseTitle: z.string().nullish(),
  })
  .passthrough();

export const moveResultSchema = z.object({ position: z.number(), total: z.number() }).passthrough();

export const moduleContextSchema = z
  .object({ moduleOrdinal: z.number(), moduleTotal: z.number() })
  .passthrough();

export const lessonContextSchema = z
  .object({
    moduleOrdinal: z.number(),
    lessonOrdinal: z.number(),
    moduleTotal: z.number(),
    lessonTotal: z.number(),
    prevLessonId: z.number().nullable(),
    nextLessonId: z.number().nullable(),
  })
  .passthrough();

export const chatSessionRowSchema = z
  .object({
    id: z.number(),
    chatId: z.string(),
    mode: z.string(),
    modelId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

/**
 * Core's `GET /api/chats/:chatId/messages`, which AI-Tutor's chat-session route
 * proxies verbatim. Each message is built by Core's `reviveStoredMessage`, which
 * keys the message by `id` — the earlier `messageId` here matched no field Core
 * has ever sent, so the restored id was silently `undefined` under the old cast.
 */
export const chatMessagesSchema = z
  .object({
    chat: z.object({ id: z.string(), title: z.string().nullable() }).passthrough(),
    messages: z.array(
      z.object({ id: z.string(), role: z.string(), content: z.unknown() }).passthrough(),
    ),
  })
  .passthrough();

export const apiKeyValidationSchema = z
  .object({ valid: z.boolean(), error: z.string().optional() })
  .passthrough();

export const okSchema = z.object({ ok: z.literal(true) }).passthrough();

export const okWithRoleSchema = z
  .object({ ok: z.literal(true), role: enrollmentRoleSchema })
  .passthrough();

/**
 * The status-only row `PATCH /admin/bug-reports/:id` answers with. The service
 * deliberately returns just the two fields it changed, and the admin view
 * spread-merges them onto the row it already holds, so this must not require
 * the full `adminBugReportRowSchema` shape.
 */
export const bugReportStatusUpdatedSchema = z
  .object({
    id: z.string(),
    status: bugReportStatusSchema,
  })
  .passthrough();

/**
 * The AI-policy payload as Core sends it, before `normalizePolicy` applies the
 * fallbacks. Every field is independently recoverable because this is an admin
 * setting a human typed: one malformed field must not blank the whole policy.
 */
export const adminAiModelPolicySchema = z
  .object({
    allowedTutorModelIds: z.array(z.string()).optional().catch(undefined),
    defaultTutorModelId: z.string().nullish().catch(undefined),
    defaultSupervisorModelId: z.string().nullish().catch(undefined),
    dualLoopEnabled: z.boolean().optional().catch(undefined),
    maxSupervisorIterations: z.number().optional().catch(undefined),
  })
  .passthrough();

export type WireAdminAiModelPolicy = z.infer<typeof adminAiModelPolicySchema>;

/** Core answers with the policy itself on some routes and `{ policy }` on others. */
export const adminAiModelPolicyResponseSchema = z.union([
  z.object({ policy: adminAiModelPolicySchema }).transform((envelope) => envelope.policy),
  adminAiModelPolicySchema,
]);

/** A move answers with the moved row plus its new position among its siblings. */
export const moduleMoveSchema = moveResultSchema.extend({ module: moduleSchema });
export const lessonMoveSchema = moveResultSchema.extend({ lesson: lessonSchema });
export const activityMoveSchema = moveResultSchema.extend({ activity: activitySchema });

/** Every list endpoint answers with the same envelope around its own rows. */
export function paginatedSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z
    .object({
      data: z.array(row),
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
    })
    .passthrough();
}
