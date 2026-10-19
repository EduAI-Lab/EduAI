/**
 * PATCH /api/courses/:id/student-visibility — what enrolled students see (#2002):
 * whether they may browse the course's files, and which approved topics are
 * shown to them on the course page and in course chat.
 *
 * Auth: the course Settings tab's audience — ADMIN, UNIT_ADMIN of the course's
 * unit, or the course's INSTRUCTOR. TAs and students are refused.
 *
 * Every field is optional and only the fields sent are written, so a save
 * carries just what that manager changed and cannot undo another manager's
 * change to anything else. Topic ids are checked before anything is written:
 * one that is not an approved topic of this course rejects the whole save.
 *
 * No GET — the course detail loader and the topics API supply the UI state.
 */
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse } from "~/lib/api/json-response.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { invalidateCourseTopicNamesCache } from "~/lib/courses/server";
import { withErrorResponse } from "~/lib/errors.server";
import prisma from "~/lib/prisma.server";
import { canEditCourse } from "~/lib/rbac/permissions";
import { FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";

const StudentVisibilitySchema = z
  .object({
    studentFilesVisible: z.boolean().optional(),
    topics: z
      .array(z.object({ id: z.string().min(1).max(128), visibleToStudents: z.boolean() }).strict())
      .max(1000)
      .optional(),
  })
  .strict()
  .refine((value) => value.studentFilesVisible !== undefined || (value.topics?.length ?? 0) > 0)
  .refine(
    (value) => !value.topics || new Set(value.topics.map((t) => t.id)).size === value.topics.length,
  );

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "PATCH") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const courseId = params.id;
      if (!courseId) {
        return jsonResponse({ error: "COURSE_ID_REQUIRED" }, 400);
      }

      const session = await getRequestSession(request);
      if (!session?.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { course, access } = await resolveCourseAccessGate(session.user, courseId);
      if (!course) {
        return jsonResponse({ error: "COURSE_NOT_FOUND" }, 404);
      }
      if (!access || !canEditCourse(access.level)) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }

      const parsed = StudentVisibilitySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return jsonResponse({ error: "VALIDATION_ERROR" }, 422);
      }
      const { studentFilesVisible, topics = [] } = parsed.data;

      // The topics a learner can be shown at all (LEARNER_TOPIC_WHERE without the
      // flag being set): never a suggestion or the Uncategorized fallback.
      const eligible = {
        courseId,
        deletedAt: null,
        reviewStatus: "ACCEPTED" as const,
        name: { not: FALLBACK_TOPIC_NAME },
      };
      const saved = await prisma.$transaction(async (tx) => {
        if (topics.length > 0) {
          const found = await tx.courseTopic.count({
            where: { ...eligible, id: { in: topics.map((t) => t.id) } },
          });
          if (found !== topics.length) return false;
        }
        if (studentFilesVisible !== undefined) {
          await tx.course.update({ where: { id: courseId }, data: { studentFilesVisible } });
        }
        for (const visibleToStudents of [true, false]) {
          const ids = topics
            .filter((t) => t.visibleToStudents === visibleToStudents)
            .map((t) => t.id);
          if (ids.length > 0) {
            await tx.courseTopic.updateMany({
              where: { ...eligible, id: { in: ids } },
              data: { visibleToStudents },
            });
          }
        }
        return true;
      });
      if (!saved) {
        return jsonResponse({ error: "TOPIC_NOT_ELIGIBLE" }, 422);
      }

      // Only once the write has committed: course chat caches topic names, and a
      // read that started earlier must not re-cache a topic hidden just now.
      invalidateCourseTopicNamesCache(courseId);

      return jsonResponse({ success: true });
    },
    { request },
  );
}
