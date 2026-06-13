import { tool } from "ai";
import { z } from "zod";

import type { ChatToolContext } from "./chat-mode";
import {
  getAccessibleCourse,
  listAccessibleCourses,
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminUsers,
} from "./admin-context.server";

/** Admin assistant tools — platform ops, no RAG. ADMIN-only tools are gated in handlers. */
export function createAdminChatTools(ctx: ChatToolContext) {  const { user, effectiveCourseId } = ctx;

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
        "List enrollments for a course. Filter by enrolledAt window to answer questions like who joined last week.",
      parameters: z.object({
        courseId: z
          .string()
          .optional()
          .describe("Course id; defaults to the selected course in the admin chat UI"),
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
      execute: async ({ courseId, enrolledSince, enrolledBefore, isActive }) => {
        const id = courseId ?? effectiveCourseId;
        if (!id) {
          return { error: "courseId required — select a course or pass courseId" };
        }
        return listAdminCourseEnrollments(user, id, {
          enrolledSince,
          enrolledBefore,
          isActive,
        });
      },
    }),

    listUsers: tool({
      description: "List platform users (ADMIN only). Returns id, email, name, role, active status.",
      parameters: z.object({
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async () => listAdminUsers(user),
    }),

    listBugReports: tool({
      description: "List bug reports for triage (ADMIN only).",
      parameters: z.object({
        status: z.enum(["UNHANDLED", "IN_PROGRESS", "RESOLVED"]).optional(),
        source: z.enum(["CORE", "AI_TUTOR", "QUESTION_MAKER"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ status, source, limit }) =>
        listAdminBugReportsForChat(user, { status, source, limit }),
    }),
  };
}
