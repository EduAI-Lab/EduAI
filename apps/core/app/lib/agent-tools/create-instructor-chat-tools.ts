import { tool } from "ai";
import { z } from "zod";

import type { ChatToolContext } from "./chat-mode";
import {
  getAccessibleCourse,
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  getAdminCourseTopic,
} from "./admin-context.server";

/**
 * Instructor assistant tools (#1659) — a course-scoped, read-only slice of
 * the admin tool surface for the instructor of one published course.
 *
 * Every tool below is pinned to `ctx.effectiveCourseId`, never to a courseId
 * argument the model supplies — the model has no way to ask this registry
 * about a *different* course. That is defense in depth on top of the
 * route-level gate (chat.ts requires `access.level === "instructor"` AND
 * `course.isPublished` for this exact course before instructor mode is ever
 * entered) and the underlying `getAccessibleCourse`/`getAccessibleCourseGate`
 * RBAC those helpers already run — not a replacement for either.
 *
 * Deliberately excludes: listCourses/listUsers/listBugReports (platform-wide,
 * ADMIN-only per #1659's "Done when"), and every admin write tool (course
 * CRUD, enrollment writes, AI provider/model/cron management). Course-scoped
 * writes (e.g. editing topics) are a reasonable follow-up but are out of
 * scope for this issue — see the #1659 PR description.
 */
/** Shared no-op for the (never expected) no-course fallback below. */
async function noCourseSelected() {
  return { error: "No course selected for this instructor chat" };
}

export function createInstructorChatTools(ctx: ChatToolContext) {
  const { user, effectiveCourseId } = ctx;

  // The route gate always resolves a course before entering instructor mode
  // (see chat.ts); this only guards a future call site that forgets to.
  if (!effectiveCourseId) {
    return {
      getCourse: tool({
        description: "Get metadata for your current course.",
        parameters: z.object({}),
        execute: noCourseSelected,
      }),
      listCourseEnrollments: tool({
        description: "List the roster enrolled in your current course.",
        parameters: z.object({}),
        execute: noCourseSelected,
      }),
      listCourseTopics: tool({
        description: "List the topics defined for your current course.",
        parameters: z.object({}),
        execute: noCourseSelected,
      }),
      getCourseTopic: tool({
        description: "Get one topic by id from your current course.",
        parameters: z.object({ topicId: z.string() }),
        execute: noCourseSelected,
      }),
    };
  }

  const courseId = effectiveCourseId;

  return {
    getCourse: tool({
      description:
        "Get metadata (name, code, term, description, publish state) for your current course.",
      parameters: z.object({}),
      execute: async () => getAccessibleCourse(user, courseId),
    }),

    listCourseEnrollments: tool({
      description:
        "List the roster (students/TAs/instructors) enrolled in your current course. Filter by isActive when asked about active vs. dropped enrollments, or by enrolledSince/enrolledBefore for time-range questions (e.g. 'who enrolled in the last 7 days').",
      parameters: z.object({
        limit: z.number().int().min(1).max(50).optional(),
        isActive: z.boolean().optional().describe("Filter by active enrollment status"),
        enrolledSince: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or after this time"),
        enrolledBefore: z
          .string()
          .optional()
          .describe("ISO date — include enrollments on or before this time"),
      }),
      execute: async ({ limit, isActive, enrolledSince, enrolledBefore }) =>
        listAdminCourseEnrollments(user, courseId, {
          limit,
          isActive,
          enrolledSince,
          enrolledBefore,
        }),
    }),

    listCourseTopics: tool({
      description: "List the topics defined for your current course.",
      parameters: z.object({}),
      execute: async () => listAdminCourseTopics(user, courseId),
    }),

    getCourseTopic: tool({
      description: "Get one topic by id from your current course.",
      parameters: z.object({
        topicId: z.string().describe("Topic id (CUID)"),
      }),
      execute: async ({ topicId }) => getAdminCourseTopic(user, courseId, topicId),
    }),
  };
}
