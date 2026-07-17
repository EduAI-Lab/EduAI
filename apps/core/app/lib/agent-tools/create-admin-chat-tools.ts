import { tool } from "ai";
import { z } from "zod";

import type { ChatToolContext } from "./chat-mode";
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
  createAdminEnrollment,
  createAdminCourseTopic,
  createAdminUser,
  deactivateAdminEnrollment,
  deleteAdminCourseTopic,
  deleteAdminUser,
  runConfirmedAdminWriteTool,
  updateAdminBugReportStatus,
  updateAdminCourseTopic,
  updateAdminEnrollmentRole,
  updateAdminUser,
  userRefValidationError,
} from "./admin-mutations.server";

/** Defaults to false so omitted/invalid values do not crash the tool-call stream. */
const confirmedWrite = z
  .boolean()
  .default(false)
  .describe(
    "false until the admin explicitly confirms in chat (e.g. yes, do it); then true to apply the write",
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

/** Admin assistant tools — platform ops with read + write (ADMIN-only). */
export function createAdminChatTools(ctx: ChatToolContext) {
  const { user, effectiveCourseId, effectiveCourseCode } = ctx;

  const resolveCourse = (courseId?: string, courseCode?: string) =>
    resolveAdminCourseId(user, {
      courseId,
      courseCode: courseCode ?? effectiveCourseCode ?? undefined,
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

    createUser: tool({
      description:
        "Create a new platform user. Call with confirmed=false first to preview; after admin confirms in chat, call again with confirmed=true.",
      parameters: z.object({
        confirmed: confirmedWrite,
        name: z.string().min(2),
        email: z.string().email(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"]),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed, ...input }) =>
        runConfirmedAdminWriteTool("createUser", user, confirmed, () =>
          createAdminUser(user, input),
        ),
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
        return runConfirmedAdminWriteTool("updateUser", user, confirmed, async () => {
          const { resolveAdminUserId } = await import("./admin-context.server");
          const target = await resolveAdminUserId(user, { userId, userEmail });
          if ("error" in target) {
            return target;
          }
          return updateAdminUser(user, target.userId, updates);
        });
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
        return runConfirmedAdminWriteTool("deleteUser", user, confirmed, async () => {
          const { resolveAdminUserId } = await import("./admin-context.server");
          const target = await resolveAdminUserId(user, { userId, userEmail });
          if ("error" in target) {
            return target;
          }
          return deleteAdminUser(user, target.userId);
        });
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
      }),
      execute: async ({ confirmed, courseId, courseCode, userId, userEmail, role }) => {
        const userRefError = userRefValidationError({ userId, userEmail });
        if (userRefError) {
          return userRefError;
        }
        return runConfirmedAdminWriteTool("createCourseEnrollment", user, confirmed, () =>
          createAdminEnrollment(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            userId,
            userEmail,
            role,
          }),
        );
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
        runConfirmedAdminWriteTool("updateCourseEnrollment", user, confirmed, () =>
          updateAdminEnrollmentRole(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            enrollmentId,
            role,
          }),
        ),
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
        runConfirmedAdminWriteTool("deactivateCourseEnrollment", user, confirmed, () =>
          deactivateAdminEnrollment(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            enrollmentId,
          }),
        ),
    }),

    updateBugReportStatus: tool({
      description: "Update triage status on a bug report. Use confirmed=true only after admin confirms.",
      parameters: z.object({
        confirmed: confirmedWrite,
        reportId: z.string().describe("Bug report id"),
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]),
      }),
      execute: async ({ confirmed, reportId, status }) =>
        runConfirmedAdminWriteTool("updateBugReportStatus", user, confirmed, () =>
          updateAdminBugReportStatus(user, reportId, status),
        ),
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
        runConfirmedAdminWriteTool("createCourseTopic", user, confirmed, () =>
          createAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            name,
          }),
        ),
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
        runConfirmedAdminWriteTool("updateCourseTopic", user, confirmed, () =>
          updateAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            topicId,
            name,
          }),
        ),
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
        runConfirmedAdminWriteTool("deleteCourseTopic", user, confirmed, () =>
          deleteAdminCourseTopic(user, {
            courseId,
            courseCode,
            fallbackCourseId: effectiveCourseId,
            topicId,
            name,
          }),
        ),
    }),
  };
}
