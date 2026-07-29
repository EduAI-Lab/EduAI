import { tool } from "ai";
import { z } from "zod";

import type { ChatToolContext } from "./chat-mode";
import { runIdempotentAdminMutation } from "./idempotent-admin-mutation.server";
import {
  getAccessibleCourse,
  listAccessibleCourses,
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  getAdminCourseTopic,
  listAdminUsers,
  resolveAdminCourseId,
} from "./admin-context.server";
import {
  getAdminCanvasIntegration,
  listAdminCanvasCourses,
  listAdminInvitations,
} from "./admin-reads.server";
import {
  connectAdminCanvas,
  createAdminEnrollment,
  createAdminCourseTopic,
  createAdminInvitationMutation,
  createAdminUser,
  deactivateAdminEnrollment,
  deleteAdminCourseTopic,
  deleteAdminUser,
  disconnectAdminCanvas,
  linkAdminCanvasRoster,
  resendAdminInvitationMutation,
  revokeAdminInvitationMutation,
  runConfirmedAdminWriteTool,
  syncAdminCanvasCourses,
  updateAdminBugReportStatus,
  updateAdminCourseTopic,
  updateAdminEnrollmentRole,
  updateAdminUser,
  userRefValidationError,
  createAdminCourseMutation,
  updateAdminCourseMutation,
  deleteAdminCourseMutation,
  publishAdminCourseMutation,
  unpublishAdminCourseMutation,
  updateAdminCourseRagSettingsMutation,
  renameAdminCourseMaterialMutation,
  deleteAdminCourseMaterialMutation,
  updateAdminCourseEmbeddingSettingsMutation,
  startAdminCourseReEmbedMutation,
  syncAdminCanvasMaterialsMutation,
  addAdminCourseTAMutation,
  removeAdminCourseTAMutation,
  updateAdminPolicyMutation,
  createAdminAiProviderMutation,
  updateAdminAiProviderMutation,
  deleteAdminAiProviderMutation,
  createAdminAiModelMutation,
  updateAdminAiModelMutation,
  deleteAdminAiModelMutation,
  triggerAdminCronJobMutation,
} from "./admin-mutations.server";
import {
  getAdminCourseRagSettings,
  getAdminCourseEmbeddingSettings,
  getAdminCourseReEmbedJob,
  getAdminDashboardStats,
  getAdminPolicies,
  listAdminAiProviders,
  listAdminCanvasMaterials,
  listAdminCourseChats,
  listAdminCourseMaterials,
  listAdminCourseTAs,
  listAdminCronJobs,
  listAdminOllamaModels,
  listAdminUnitChats,
  listAdminVllmModels,
} from "./admin-platform.server";

/** Defaults to false so omitted/invalid values do not crash the tool-call stream. */
const confirmedWrite = z
  .boolean()
  .default(false)
  .describe(
    "false until the admin explicitly confirms in a later chat message; then true to apply the write (same-generation confirmed:true is rejected)",
  );

const enrollmentRole = z.enum(["STUDENT", "TA", "INSTRUCTOR"]);

const courseScope = {
  courseId: z
    .string()
    .optional()
    .describe("Course id (CUID); required unless courseCode is provided"),
  courseCode: z
    .string()
    .optional()
    .describe("Course code; required unless courseId is provided"),
};

const userRef = {
  userId: z.string().optional().describe("Platform user id (CUID)"),
  userEmail: z
    .string()
    .email()
    .optional()
    .describe("Platform user email — use when id is unknown"),
};

const instructorRef = {
  instructorUserId: z
    .string()
    .optional()
    .describe("Instructor user id — omit to use the admin's own Canvas integration"),
  instructorEmail: z
    .string()
    .email()
    .optional()
    .describe("Instructor email when id is unknown"),
};

/** Admin assistant tools — platform ops with read + write (ADMIN-only). */
export function createAdminChatTools(ctx: ChatToolContext) {
  const { user, effectiveCourseId, effectiveCourseCode } = ctx;
  const turnId = ctx.turnId ?? null;
  const confirmWrite = (
    toolName: string,
    confirmed: boolean,
    run: () => Promise<Record<string, unknown>>,
    payload: Record<string, unknown> = {},
  ) => runConfirmedAdminWriteTool(toolName, user, confirmed, run, payload, turnId);


  const resolveCourse = (courseId?: string, courseCode?: string) =>
    resolveAdminCourseId(user, {
      courseId,
      courseCode: courseCode ?? effectiveCourseCode ?? undefined,
      fallbackCourseId: effectiveCourseId,
    });

  const courseOpts = (courseId?: string, courseCode?: string) => ({
    courseId,
    courseCode,
    fallbackCourseId: effectiveCourseId,
  });

  return {
    listCourses: tool({
      description: "List all courses visible to the admin (platform-wide for ADMIN role).",
      parameters: z.object({}),
      execute: async () => listAccessibleCourses(user),
    }),

    getCourse: tool({
      description: "Get metadata for one course by id.",
      parameters: z.object({
        courseId: z.string().describe("Course id (CUID)"),
      }),
      execute: async ({ courseId }) => getAccessibleCourse(user, courseId),
    }),

    listCourseEnrollments: tool({
      description:
        "List users enrolled in a course (roster). Requires courseId or courseCode. Filter by enrolledAt window for time-range questions, or by userId/userEmail to look up one specific enrollment (e.g. before an update/deactivate write) — an exact user lookup is not subject to the list's row limit, so it still finds enrollments outside the newest page.",
      parameters: z.object({
        ...courseScope,
        ...userRef,
        limit: z.number().int().min(1).max(50).optional(),
        enrolledSince: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or after this time"),
        enrolledBefore: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or before this time"),
        isActive: z.boolean().optional().describe("Filter by active enrollment status"),
      }),
      execute: async ({
        courseId,
        courseCode,
        userId,
        userEmail,
        enrolledSince,
        enrolledBefore,
        isActive,
        limit,
      }) => {
        const resolved = await resolveCourse(courseId, courseCode);
        if ("error" in resolved) {
          return resolved;
        }
        return listAdminCourseEnrollments(user, resolved.courseId, {
          userId,
          userEmail,
          enrolledSince,
          enrolledBefore,
          isActive,
          limit,
        });
      },
    }),

    listCourseTopics: tool({
      description:
        "List question/RAG topics for a course. Requires courseId or courseCode. Maps to GET /api/courses/:id/topics.",
      parameters: z.object({
        ...courseScope,
      }),
      execute: async ({ courseId, courseCode }) => {
        const resolved = await resolveCourse(courseId, courseCode);
        if ("error" in resolved) {
          return resolved;
        }
        return listAdminCourseTopics(user, resolved.courseId);
      },
    }),

    getCourseTopic: tool({
      description:
        "Get one course topic by id. Requires courseId or courseCode plus topicId.",
      parameters: z.object({
        ...courseScope,
        topicId: z.string().describe("Topic id (CUID)"),
      }),
      execute: async ({ courseId, courseCode, topicId }) => {
        const resolved = await resolveCourse(courseId, courseCode);
        if ("error" in resolved) {
          return resolved;
        }
        return getAdminCourseTopic(user, resolved.courseId, topicId);
      },
    }),

    listUsers: tool({
      description:
        "List or search platform users (ADMIN only). Pass email for an exact lookup, or query to search email/name. Without filters returns the newest users (default 25, max 50). Never invent similar emails when a search returns empty — report not found. For course rosters use listCourseEnrollments.",
      parameters: z.object({
        email: z
          .string()
          .email()
          .optional()
          .describe("Exact user email lookup (preferred when the admin names an email)"),
        query: z
          .string()
          .min(1)
          .optional()
          .describe("Substring search on email or name when email is unknown"),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ email, query, limit }) =>
        listAdminUsers(user, { email, query, limit }),
    }),

    listBugReports: tool({
      description: "List bug reports for triage from the database (ADMIN only).",
      parameters: z.object({
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]).optional(),
        source: z.enum(["CORE", "AI_TUTOR", "QUESTION_MAKER"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ status, source, limit }) =>
        listAdminBugReportsForChat(user, { status, source, limit }),
    }),

    listInvitations: tool({
      description:
        "List platform invitations (ADMIN only). Includes pending, accepted, and revoked invites.",
      parameters: z.object({
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({ limit }) => listAdminInvitations(user, limit),
    }),

    getCanvasIntegration: tool({
      description:
        "Get Canvas integration status for the admin or a target instructor. Maps to GET /api/canvas/integration.",
      parameters: z.object({ ...instructorRef }),
      execute: async ({ instructorUserId, instructorEmail }) =>
        getAdminCanvasIntegration(user, { instructorUserId, instructorEmail }),
    }),

    listCanvasCourses: tool({
      description:
        "List Canvas courses with Core sync state for the admin or a target instructor. Maps to GET /api/canvas/courses.",
      parameters: z.object({ ...instructorRef }),
      execute: async ({ instructorUserId, instructorEmail }) =>
        listAdminCanvasCourses(user, { instructorUserId, instructorEmail }),
    }),

    createUser: tool({
      description:
        "Create a new platform user. Call with confirmed=false first to preview; after admin confirms in chat, call again with confirmed=true.",
      parameters: z.object({
        confirmed: confirmedWrite,
        name: z.string().min(2),
        email: z.string().email(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"]),
        isActive: z.boolean().optional(),
        idempotencyKey: z.string().min(1),
      }),
      execute: async ({ confirmed, idempotencyKey, ...input }) =>
        confirmWrite("createUser", confirmed, () =>
          runIdempotentAdminMutation(
            user.id,
            "POST /api/users",
            idempotencyKey,
            input,
            () => createAdminUser(user, input),
          ), { idempotencyKey, ...input }),
    }),

    updateUser: tool({
      description:
        "Update a platform user. Pass userId or userEmail. Use confirmed=false until admin approves, then confirmed=true.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...userRef,
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"]).optional(),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed, userId, userEmail, ...updates }) => {
        const userRefError = userRefValidationError({ userId, userEmail });
        if (userRefError) {
          return userRefError;
        }
        return confirmWrite("updateUser", confirmed, async () => {
          const { resolveAdminUserId } = await import("./admin-context.server");
          const target = await resolveAdminUserId(user, { userId, userEmail });
          if ("error" in target) {
            return target;
          }
          return updateAdminUser(user, target.userId, updates);
        }, { ...updates, userId, userEmail });
      },
    }),

    deleteUser: tool({
      description:
        "Permanently delete a platform user. Pass userId or userEmail. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...userRef,
      }),
      execute: async ({ confirmed, userId, userEmail }) => {
        const userRefError = userRefValidationError({ userId, userEmail });
        if (userRefError) {
          return userRefError;
        }
        return confirmWrite("deleteUser", confirmed, async () => {
          const { resolveAdminUserId } = await import("./admin-context.server");
          const target = await resolveAdminUserId(user, { userId, userEmail });
          if ("error" in target) {
            return target;
          }
          return deleteAdminUser(user, target.userId);
        }, { userId, userEmail });
      },
    }),

    createCourseEnrollment: tool({
      description:
        "Add a user to a course with a role. Pass userId or userEmail. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        ...userRef,
        role: enrollmentRole,
        idempotencyKey: z.string().min(1),
      }),
      execute: async ({
        confirmed,
        courseId,
        courseCode,
        userId,
        userEmail,
        role,
        idempotencyKey,
      }) => {
        const userRefError = userRefValidationError({ userId, userEmail });
        if (userRefError) {
          return userRefError;
        }
        const input = {
          courseId,
          courseCode,
          fallbackCourseId: effectiveCourseId,
          userId,
          userEmail,
          role,
        };
        return confirmWrite("createCourseEnrollment", confirmed, () =>
          runIdempotentAdminMutation(
            user.id,
            "POST /api/courses/:id/enrollments",
            idempotencyKey,
            input,
            () => createAdminEnrollment(user, input),
          ), { courseId, courseCode, userId, userEmail, role, idempotencyKey });
      },
    }),

    updateCourseEnrollment: tool({
      description:
        "Change an enrollment role. Enforces instructor-floor rules. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        enrollmentId: z.string().describe("Enrollment id (CUID)"),
        role: enrollmentRole,
      }),
      execute: async ({ confirmed, courseId, courseCode, enrollmentId, role }) =>
        confirmWrite("updateCourseEnrollment", confirmed, () =>
          updateAdminEnrollmentRole(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            enrollmentId,
            role,
          }), { courseId, courseCode, enrollmentId, role }),
    }),

    deactivateCourseEnrollment: tool({
      description:
        "Soft-remove an enrollment (sets isActive=false). Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        enrollmentId: z.string().describe("Enrollment id (CUID)"),
      }),
      execute: async ({ confirmed, courseId, courseCode, enrollmentId }) =>
        confirmWrite("deactivateCourseEnrollment", confirmed, () =>
          deactivateAdminEnrollment(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            enrollmentId,
          }), { courseId, courseCode, enrollmentId }),
    }),

    updateBugReportStatus: tool({
      description: "Update triage status on a bug report. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        reportId: z.string().describe("Bug report id"),
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]),
      }),
      execute: async ({ confirmed, reportId, status }) =>
        confirmWrite("updateBugReportStatus", confirmed, () =>
          updateAdminBugReportStatus(user, reportId, status), { reportId, status }),
    }),

    createCourseTopic: tool({
      description:
        "Create a topic under a course. Requires courseId or courseCode and topic name. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        name: z.string().min(1).describe("Topic display name"),
      }),
      execute: async ({ confirmed, courseId, courseCode, name }) =>
        confirmWrite("createCourseTopic", confirmed, () =>
          createAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            name,
          }), { courseId, courseCode, name }),
    }),

    updateCourseTopic: tool({
      description:
        "Rename a course topic. Requires courseId or courseCode, topicId, and new name. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        topicId: z.string().describe("Topic id (CUID)"),
        name: z.string().min(1).describe("New topic name"),
      }),
      execute: async ({ confirmed, courseId, courseCode, topicId, name }) =>
        confirmWrite("updateCourseTopic", confirmed, () =>
          updateAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            topicId,
            name,
          }), { courseId, courseCode, topicId, name }),
    }),

    deleteCourseTopic: tool({
      description:
        "Soft-delete a course topic by topicId or name. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        topicId: z.string().optional().describe("Topic id (CUID)"),
        name: z.string().optional().describe("Topic name when id is unknown"),
      }),
      execute: async ({ confirmed, courseId, courseCode, topicId, name }) =>
        confirmWrite("deleteCourseTopic", confirmed, () =>
          deleteAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            topicId,
            name,
          }), { courseId, courseCode, topicId, name }),
    }),

    createInvitation: tool({
      description:
        "Create a platform invitation and send the accept-link email. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        email: z.string().email(),
        name: z.string().min(2).optional(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"]),
        authorizedUnits: z
          .array(z.string())
          .optional()
          .describe("Required when role is UNIT_ADMIN"),
      }),
      execute: async ({ confirmed, email, name, role, authorizedUnits }) =>
        confirmWrite("createInvitation", confirmed, () =>
          createAdminInvitationMutation(user, { email, name, role, authorizedUnits }), { email, name, role, authorizedUnits }),
    }),

    revokeInvitation: tool({
      description:
        "Revoke a pending invitation by id. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        invitationId: z.string().describe("Invitation id (CUID)"),
      }),
      execute: async ({ confirmed, invitationId }) =>
        confirmWrite("revokeInvitation", confirmed, () =>
          revokeAdminInvitationMutation(user, invitationId), { invitationId }),
    }),

    resendInvitation: tool({
      description:
        "Resend a pending invitation email (rotates token). Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        invitationId: z.string().describe("Invitation id (CUID)"),
      }),
      execute: async ({ confirmed, invitationId }) =>
        confirmWrite("resendInvitation", confirmed, () =>
          resendAdminInvitationMutation(user, invitationId), { invitationId }),
    }),

    connectCanvas: tool({
      description:
        "Connect Canvas for the admin or a target instructor. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...instructorRef,
        canvasUrl: z.string().url(),
        apiKey: z.string().optional(),
        isTestMode: z.boolean().optional(),
      }),
      execute: async ({
        confirmed,
        instructorUserId,
        instructorEmail,
        canvasUrl,
        apiKey,
        isTestMode,
      }) =>
        confirmWrite("connectCanvas", confirmed, () =>
          connectAdminCanvas(user, {
            instructorUserId,
            instructorEmail,
            canvasUrl,
            apiKey,
            isTestMode,
          }), { instructorUserId, instructorEmail, canvasUrl, apiKey, isTestMode }),
    }),

    syncCanvasCourses: tool({
      description:
        "Sync selected Canvas courses into Core for an instructor. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...instructorRef,
        canvasCourseIds: z.array(z.string()).describe("Canvas course ids to sync"),
      }),
      execute: async ({
        confirmed,
        instructorUserId,
        instructorEmail,
        canvasCourseIds,
      }) =>
        confirmWrite("syncCanvasCourses", confirmed, () =>
          syncAdminCanvasCourses(user, {
            instructorUserId,
            instructorEmail,
            canvasCourseIds,
          }), { instructorUserId, instructorEmail, canvasCourseIds }),
    }),

    disconnectCanvas: tool({
      description:
        "Disconnect Canvas integration for the admin or a target instructor. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...instructorRef,
      }),
      execute: async ({ confirmed, instructorUserId, instructorEmail }) =>
        confirmWrite("disconnectCanvas", confirmed, () =>
          disconnectAdminCanvas(user, { instructorUserId, instructorEmail }), { instructorUserId, instructorEmail }),
    }),

    linkCanvasRoster: tool({
      description:
        "Link Canvas enrollments for a student/TA by student number. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...userRef,
        studentNumber: z.string().min(1).describe("Student number / SIS id"),
      }),
      execute: async ({ confirmed, userId, userEmail, studentNumber }) => {
        const userRefError = userRefValidationError({ userId, userEmail });
        if (userRefError) {
          return userRefError;
        }
        return confirmWrite("linkCanvasRoster", confirmed, () =>
          linkAdminCanvasRoster(user, { userId, userEmail, studentNumber }), { userId, userEmail, studentNumber });
      },
    }),

    createCourse: tool({
      description:
        "Create a new course with instructor enrollments. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        name: z.string().min(1),
        code: z.string().min(1),
        section: z.string().min(1),
        term: z.string().min(1),
        year: z.number().int(),
        startDate: z.string().describe("ISO date string"),
        endDate: z.string().optional().describe("ISO date string"),
        department: z.string().min(1),
        description: z.string().optional(),
        isPublished: z.boolean().optional(),
        aiInstructions: z.string().optional(),
        instructorUserIds: z.array(z.string()).min(1),
      }),
      execute: async ({ confirmed, ...input }) =>
        confirmWrite("createCourse", confirmed, () =>
          createAdminCourseMutation(user, input), input),
    }),

    updateCourse: tool({
      description:
        "Update course metadata. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        name: z.string().min(1).optional(),
        code: z.string().min(1).optional(),
        section: z.string().min(1).optional(),
        term: z.string().optional(),
        year: z.number().int().optional(),
        startDate: z.string().optional().describe("ISO date string"),
        endDate: z.string().optional().nullable().describe("ISO date string"),
        department: z.string().min(1).optional().nullable(),
        description: z.string().optional().nullable(),
        isPublished: z.boolean().optional(),
        isActive: z.boolean().optional(),
        aiInstructions: z.string().optional(),
        instructorId: z.string().optional(),
      }),
      execute: async ({ confirmed, courseId, courseCode, ...input }) =>
        confirmWrite("updateCourse", confirmed, () =>
          updateAdminCourseMutation(user, courseOpts(courseId, courseCode), input), { courseId, courseCode, ...input }),
    }),

    deleteCourse: tool({
      description: "Soft-delete a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
      }),
      execute: async ({ confirmed, courseId, courseCode }) =>
        confirmWrite("deleteCourse", confirmed, () =>
          deleteAdminCourseMutation(user, courseOpts(courseId, courseCode)), { courseId, courseCode }),
    }),

    publishCourse: tool({
      description: "Publish a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
      }),
      execute: async ({ confirmed, courseId, courseCode }) =>
        confirmWrite("publishCourse", confirmed, () =>
          publishAdminCourseMutation(user, courseOpts(courseId, courseCode)), { courseId, courseCode }),
    }),

    unpublishCourse: tool({
      description: "Unpublish a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
      }),
      execute: async ({ confirmed, courseId, courseCode }) =>
        confirmWrite("unpublishCourse", confirmed, () =>
          unpublishAdminCourseMutation(user, courseOpts(courseId, courseCode)), { courseId, courseCode }),
    }),

    getCourseRagSettings: tool({
      description: "Get RAG retrieval settings for a course.",
      parameters: z.object({ ...courseScope }),
      execute: async ({ courseId, courseCode }) =>
        getAdminCourseRagSettings(user, courseOpts(courseId, courseCode)),
    }),

    updateCourseRagSettings: tool({
      description:
        "Update RAG top-K and similarity threshold for a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        ragTopK: z.number().int().min(1).max(20).nullable().optional(),
        ragSimilarityThreshold: z.number().gt(0).lt(1).nullable().optional(),
      }),
      execute: async ({ confirmed, courseId, courseCode, ...input }) =>
        confirmWrite("updateCourseRagSettings", confirmed, () =>
          updateAdminCourseRagSettingsMutation(user, courseOpts(courseId, courseCode), input), { courseId, courseCode, ...input }),
    }),

    listCourseMaterials: tool({
      description: "List uploaded course materials (non-deleted).",
      parameters: z.object({ ...courseScope }),
      execute: async ({ courseId, courseCode }) =>
        listAdminCourseMaterials(user, courseOpts(courseId, courseCode)),
    }),

    renameCourseMaterial: tool({
      description:
        "Rename a course material. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        materialId: z.string().min(1),
        name: z.string().min(1),
      }),
      execute: async ({ confirmed, courseId, courseCode, materialId, name }) =>
        confirmWrite("renameCourseMaterial", confirmed, () =>
          renameAdminCourseMaterialMutation(user, {
            ...courseOpts(courseId, courseCode),
            materialId,
            name,
          }), { courseId, courseCode, materialId, name }),
    }),

    deleteCourseMaterial: tool({
      description:
        "Soft-delete a course material. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        materialId: z.string().min(1),
      }),
      execute: async ({ confirmed, courseId, courseCode, materialId }) =>
        confirmWrite("deleteCourseMaterial", confirmed, () =>
          deleteAdminCourseMaterialMutation(user, {
            ...courseOpts(courseId, courseCode),
            materialId,
          }), { courseId, courseCode, materialId }),
    }),

    listCanvasMaterials: tool({
      description: "Discover Canvas-linked materials available to sync for a course.",
      parameters: z.object({ ...courseScope }),
      execute: async ({ courseId, courseCode }) =>
        listAdminCanvasMaterials(user, courseOpts(courseId, courseCode)),
    }),

    syncCanvasMaterials: tool({
      description:
        "Import selected Canvas files as course materials. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        canvasFileIds: z.array(z.string()).min(1),
      }),
      execute: async ({ confirmed, courseId, courseCode, canvasFileIds }) =>
        confirmWrite("syncCanvasMaterials", confirmed, () =>
          syncAdminCanvasMaterialsMutation(user, {
            ...courseOpts(courseId, courseCode),
            canvasFileIds,
          }), { courseId, courseCode, canvasFileIds }),
    }),

    getCourseEmbeddingSettings: tool({
      description: "Get embedding provider/model settings and re-embed staleness for a course.",
      parameters: z.object({ ...courseScope }),
      execute: async ({ courseId, courseCode }) =>
        getAdminCourseEmbeddingSettings(user, courseOpts(courseId, courseCode)),
    }),

    updateCourseEmbeddingSettings: tool({
      description:
        "Update embedding provider/model for a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        embeddingProvider: z.string().optional(),
        embeddingModel: z.string().optional(),
      }),
      execute: async ({ confirmed, courseId, courseCode, ...input }) =>
        confirmWrite("updateCourseEmbeddingSettings", confirmed, () =>
          updateAdminCourseEmbeddingSettingsMutation(user, courseOpts(courseId, courseCode), input), { courseId, courseCode, ...input }),
    }),

    startCourseReEmbed: tool({
      description:
        "Start a background re-embed job for course materials. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
      }),
      execute: async ({ confirmed, courseId, courseCode }) =>
        confirmWrite("startCourseReEmbed", confirmed, () =>
          startAdminCourseReEmbedMutation(user, courseOpts(courseId, courseCode)), { courseId, courseCode }),
    }),

    getCourseReEmbedJob: tool({
      description: "Get status of a course re-embed job by job id.",
      parameters: z.object({
        ...courseScope,
        jobId: z.string().min(1),
      }),
      execute: async ({ courseId, courseCode, jobId }) =>
        getAdminCourseReEmbedJob(user, { ...courseOpts(courseId, courseCode), jobId }),
    }),

    listCourseTAs: tool({
      description: "List teaching assistants enrolled in a course.",
      parameters: z.object({ ...courseScope }),
      execute: async ({ courseId, courseCode }) =>
        listAdminCourseTAs(user, courseOpts(courseId, courseCode)),
    }),

    addCourseTA: tool({
      description:
        "Add a TA enrollment to a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        userId: z.string().min(1),
      }),
      execute: async ({ confirmed, courseId, courseCode, userId }) =>
        confirmWrite("addCourseTA", confirmed, () =>
          addAdminCourseTAMutation(user, { ...courseOpts(courseId, courseCode), userId }), { courseId, courseCode, userId }),
    }),

    removeCourseTA: tool({
      description:
        "Remove a TA from a course. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        userId: z.string().min(1),
      }),
      execute: async ({ confirmed, courseId, courseCode, userId }) =>
        confirmWrite("removeCourseTA", confirmed, () =>
          removeAdminCourseTAMutation(user, { ...courseOpts(courseId, courseCode), userId }), { courseId, courseCode, userId }),
    }),

    listCourseChats: tool({
      description: "List recent chats for a course.",
      parameters: z.object({
        ...courseScope,
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ courseId, courseCode, limit }) =>
        listAdminCourseChats(user, { ...courseOpts(courseId, courseCode), limit }),
    }),

    listUnitChats: tool({
      description: "List recent chats across all courses in a department (unit).",
      parameters: z.object({
        department: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ department, limit }) => listAdminUnitChats(user, department, limit),
    }),

    getPolicies: tool({
      description: "Get platform policy flags and definitions.",
      parameters: z.object({}),
      execute: async () => getAdminPolicies(user),
    }),

    updatePolicy: tool({
      description:
        "Update a platform policy flag. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        key: z.string().min(1),
        value: z.boolean(),
      }),
      execute: async ({ confirmed, key, value }) =>
        confirmWrite("updatePolicy", confirmed, () =>
          updateAdminPolicyMutation(user, key, value), { key, value }),
    }),

    listAiProviders: tool({
      description: "List AI providers and their models.",
      parameters: z.object({}),
      execute: async () => listAdminAiProviders(user),
    }),

    createAiProvider: tool({
      description:
        "Create an AI provider. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        name: z.string().min(1),
        displayName: z.string().min(1),
        description: z.string().min(1),
        requiresApiKey: z.boolean().optional(),
        defaultBaseUrl: z.string().url().optional(),
        envVarName: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed, ...input }) =>
        confirmWrite("createAiProvider", confirmed, () =>
          createAdminAiProviderMutation(user, input), input),
    }),

    updateAiProvider: tool({
      description:
        "Update an AI provider. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        providerId: z.string().min(1),
        name: z.string().min(1).optional(),
        displayName: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        requiresApiKey: z.boolean().optional(),
        defaultBaseUrl: z.string().url().optional(),
        envVarName: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed, providerId, ...input }) =>
        confirmWrite("updateAiProvider", confirmed, () =>
          updateAdminAiProviderMutation(user, providerId, input), { providerId, ...input }),
    }),

    deleteAiProvider: tool({
      description:
        "Delete an AI provider. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        providerId: z.string().min(1),
      }),
      execute: async ({ confirmed, providerId }) =>
        confirmWrite("deleteAiProvider", confirmed, () =>
          deleteAdminAiProviderMutation(user, providerId), { providerId }),
    }),

    createAiModel: tool({
      description: "Create an AI model. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        type: z.enum(["CHAT", "COMPLETION", "EMBEDDING", "IMAGE", "AUDIO", "VIDEO"]),
        maxTokens: z.number().int().min(1).optional(),
        supportsImages: z.boolean().optional(),
        supportsTools: z.boolean().optional(),
        supportsStreaming: z.boolean().optional(),
        inputPricing: z.number().min(0).optional(),
        outputPricing: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed, ...input }) =>
        confirmWrite("createAiModel", confirmed, () =>
          createAdminAiModelMutation(user, input), input),
    }),

    updateAiModel: tool({
      description: "Update an AI model. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        id: z.string().min(1).describe("Database id of the model row"),
        modelId: z.string().min(1).optional().describe("Provider model id string"),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        type: z.enum(["CHAT", "COMPLETION", "EMBEDDING", "IMAGE", "AUDIO", "VIDEO"]).optional(),
        maxTokens: z.number().int().min(1).optional(),
        supportsImages: z.boolean().optional(),
        supportsTools: z.boolean().optional(),
        supportsStreaming: z.boolean().optional(),
        inputPricing: z.number().min(0).optional(),
        outputPricing: z.number().min(0).optional(),
        isActive: z.boolean().optional(),
        providerId: z.string().min(1).optional(),
      }),
      execute: async ({ confirmed, id, ...input }) =>
        confirmWrite("updateAiModel", confirmed, () =>
          updateAdminAiModelMutation(user, id, input), { id, ...input }),
    }),

    deleteAiModel: tool({
      description: "Delete an AI model. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        id: z.string().min(1).describe("Database id of the model row"),
      }),
      execute: async ({ confirmed, id }) =>
        confirmWrite("deleteAiModel", confirmed, () =>
          deleteAdminAiModelMutation(user, id), { id }),
    }),

    listOllamaModels: tool({
      description: "List models from the configured Ollama server.",
      parameters: z.object({
        baseUrl: z.string().optional().describe("Override OLLAMA_BASE_URL"),
      }),
      execute: async ({ baseUrl }) => listAdminOllamaModels(user, baseUrl),
    }),

    listVllmModels: tool({
      description: "List models from the configured vLLM/LiteLLM proxy.",
      parameters: z.object({}),
      execute: async () => listAdminVllmModels(user),
    }),

    listCronJobs: tool({
      description: "List scheduled cron jobs and recent runs.",
      parameters: z.object({}),
      execute: async () => listAdminCronJobs(user),
    }),

    triggerCronJob: tool({
      description:
        "Manually trigger a cron job by name. Use confirmed=true only after admin confirms. Retries with the same idempotencyKey reuse an in-flight/completed trigger.",
      parameters: z.object({
        confirmed: confirmedWrite,
        jobName: z.string().min(1),
        idempotencyKey: z.string().min(1),
      }),
      execute: async ({ confirmed, jobName, idempotencyKey }) =>
        confirmWrite("triggerCronJob", confirmed,
          () =>
            runIdempotentAdminMutation(
              user.id,
              "POST /api/admin/cron-jobs",
              idempotencyKey,
              { jobName },
              () => triggerAdminCronJobMutation(user, jobName),
            ),
          { jobName, idempotencyKey },
        ),
    }),

    getDashboardStats: tool({
      description: "Get platform dashboard statistics (users, courses, chats, materials).",
      parameters: z.object({}),
      execute: async () => getAdminDashboardStats(user),
    }),
  };
}
