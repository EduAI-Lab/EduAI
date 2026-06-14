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
  updateAdminBugReportStatus,
  updateAdminEnrollmentRole,
  updateAdminUser,
} from "./admin-mutations.server";

const confirmedWrite = z
  .literal(true)
  .describe("Must be true — the admin explicitly confirmed this write in chat");

const enrollmentRole = z.enum(["STUDENT", "TA", "INSTRUCTOR"]);

const courseScope = {
  courseId: z
    .string()
    .optional()
    .describe("Course id (CUID); defaults to the course selected in admin chat"),
  courseCode: z
    .string()
    .optional()
    .describe("Course code when course id is unknown"),
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
        "List enrollments for a course from the database. Filter by enrolledAt window for time-range questions.",
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
        "List platform users from the database (ADMIN only). Returns id, email, name, role, active status.",
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
        "Create a new platform user. Requires confirmed=true after the admin approves in chat.",
      parameters: z.object({
        confirmed: confirmedWrite,
        name: z.string().min(2),
        email: z.string().email(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"]),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed: _confirmed, ...input }) => createAdminUser(user, input),
    }),

    updateUser: tool({
      description:
        "Update a platform user by id. Requires confirmed=true. Cannot deactivate or change role of yourself.",
      parameters: z.object({
        confirmed: confirmedWrite,
        userId: z.string().describe("User id (CUID)"),
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"]).optional(),
        isActive: z.boolean().optional(),
      }),
      execute: async ({ confirmed: _confirmed, userId, ...updates }) =>
        updateAdminUser(user, userId, updates),
    }),

    deleteUser: tool({
      description:
        "Permanently delete a platform user by id. Requires confirmed=true. Cannot delete yourself.",
      parameters: z.object({
        confirmed: confirmedWrite,
        userId: z.string().describe("User id (CUID)"),
      }),
      execute: async ({ userId }) => deleteAdminUser(user, userId),
    }),

    createCourseEnrollment: tool({
      description:
        "Add a user to a course with a role. Requires confirmed=true. Idempotent if already enrolled.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        userId: z.string().describe("User id to enroll"),
        role: enrollmentRole,
      }),
      execute: async ({ courseId, courseCode, userId, role }) =>
        createAdminEnrollment(user, {
          courseId,
          courseCode,
          fallbackCourseId: effectiveCourseId,
          userId,
          role,
        }),
    }),

    updateCourseEnrollment: tool({
      description:
        "Change an enrollment role. Requires confirmed=true. Enforces instructor-floor rules.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        enrollmentId: z.string().describe("Enrollment id (CUID)"),
        role: enrollmentRole,
      }),
      execute: async ({ courseId, courseCode, enrollmentId, role }) =>
        updateAdminEnrollmentRole(user, {
          courseId,
          courseCode,
          fallbackCourseId: effectiveCourseId,
          enrollmentId,
          role,
        }),
    }),

    deactivateCourseEnrollment: tool({
      description:
        "Soft-remove an enrollment (sets isActive=false). Requires confirmed=true.",
      parameters: z.object({
        confirmed: confirmedWrite,
        ...courseScope,
        enrollmentId: z.string().describe("Enrollment id (CUID)"),
      }),
      execute: async ({ courseId, courseCode, enrollmentId }) =>
        deactivateAdminEnrollment(user, {
          courseId,
          courseCode,
          fallbackCourseId: effectiveCourseId,
          enrollmentId,
        }),
    }),

    updateBugReportStatus: tool({
      description: "Update triage status on a bug report. Requires confirmed=true.",
      parameters: z.object({
        confirmed: confirmedWrite,
        reportId: z.string().describe("Bug report id"),
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]),
      }),
      execute: async ({ reportId, status }) =>
        updateAdminBugReportStatus(user, reportId, status),
    }),
  };
}
