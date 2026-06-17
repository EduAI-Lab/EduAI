import { tool } from "ai";
import { z } from "zod";

import type { ChatToolContext } from "./chat-mode";
import {
  getAccessibleCourse,
  listAccessibleCourses,
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminUsers,
  resolveAdminCourseId,
} from "./admin-context.server";
import {
  createAdminEnrollment,
  createAdminUser,
  deactivateAdminEnrollment,
  deleteAdminUser,
  runConfirmedAdminWriteTool,
  updateAdminBugReportStatus,
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
    .describe(
      "Course id (CUID); omit when admin UI has a course selected or courseCode is known",
    ),
  courseCode: z
    .string()
    .optional()
    .describe(
      "Course code; omit when admin UI has a course selected — tool defaults to UI selection",
    ),
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
        "List users enrolled in a course (roster). Defaults to the course selected in the admin UI when courseId/courseCode are omitted. Filter by enrolledAt window for time-range questions.",
      parameters: z.object({
        ...courseScope,
        enrolledSince: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or after this time"),
        enrolledBefore: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or before this time"),
        isActive: z.boolean().optional().describe("Filter by active enrollment status"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({
        courseId,
        courseCode,
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
          enrolledSince,
          enrolledBefore,
          isActive,
          limit,
        });
      },
    }),

    listUsers: tool({
      description:
        "List all platform users (ADMIN only) — not filtered by course. For users in a specific course, use listCourseEnrollments instead.",
      parameters: z.object({
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ limit }) => listAdminUsers(user, limit),
    }),

    listBugReports: tool({
      description: "List bug reports for triage from the database (ADMIN only).",
      parameters: z.object({
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]).optional(),
        source: z.enum(["CORE", "AI_TUTOR", "QUESTION_MAKER"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
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
  };
}
