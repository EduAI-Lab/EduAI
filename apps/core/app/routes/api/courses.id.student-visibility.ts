/**
 * /api/courses/:id/student-visibility — what enrolled students see (#2002, #2061):
 * whether they may browse the course's files, which files are shown to them,
 * and which approved topics are shown. The course Settings tab's "What students
 * see" is the one place these change.
 *
 * Auth: the course Settings tab's audience — ADMIN, UNIT_ADMIN of the course's
 * unit, or the course's INSTRUCTOR. TAs and students are refused.
 *
 * GET returns the current state: the file setting, the approved topics, and
 * every live file with the approved topics it is filed under and whether
 * Canvas hides it.
 *
 * PATCH: every field is optional and only the fields sent are written, so a
 * save carries just what that manager changed and cannot undo another
 * manager's change to anything else.
 *  - `topics` shows or hides topics. A hidden topic hides its name and every
 *    file under it, including files filed under it later (HIDDEN_TOPIC_WHERE).
 *  - `materials` shows or hides single files, each audited on its own.
 *  - `fileGroup` shows or hides a whole group of files, resolved here rather
 *    than sent as ids, so it covers every file in the course however many there
 *    are, including ones added since the page loaded. `all` also shows or hides
 *    every approved topic.
 * Topic and file ids are checked before anything is written: one that is not an
 * approved topic or a live file of this course rejects the whole save.
 */
import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse } from "~/lib/api/json-response.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { invalidateCourseTopicNamesCache } from "~/lib/courses/server";
import { withErrorResponse } from "~/lib/errors.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";
import { canEditCourse } from "~/lib/rbac/permissions";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import { FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";

const VisibilityChangeSchema = z
  .object({ id: z.string().min(1).max(128), visibleToStudents: z.boolean() })
  .strict();

const FileGroupSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all"), visibleToStudents: z.boolean() }).strict(),
  z.object({ scope: z.literal("unfiled"), visibleToStudents: z.boolean() }).strict(),
  z
    .object({
      scope: z.literal("topic"),
      topicId: z.string().min(1).max(128),
      visibleToStudents: z.boolean(),
    })
    .strict(),
]);

type FileGroup = z.infer<typeof FileGroupSchema>;

/** No id twice in one list, so a save cannot both show and hide the same row. */
function distinctIds(rows: { id: string }[] | undefined) {
  return !rows || new Set(rows.map((row) => row.id)).size === rows.length;
}

const StudentVisibilitySchema = z
  .object({
    studentFilesVisible: z.boolean().optional(),
    topics: z.array(VisibilityChangeSchema).max(1000).optional(),
    // Single files picked one by one; a group goes through `fileGroup`.
    materials: z.array(VisibilityChangeSchema).max(100).optional(),
    fileGroup: FileGroupSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.studentFilesVisible !== undefined ||
      (value.topics?.length ?? 0) > 0 ||
      (value.materials?.length ?? 0) > 0 ||
      value.fileGroup !== undefined,
  )
  .refine((value) => distinctIds(value.topics) && distinctIds(value.materials));

/** How many changed file ids a group change records; the count is always exact. */
const AUDITED_GROUP_IDS = 100;

/** The topics a learner can be shown at all: never a suggestion or the Uncategorized fallback. */
function eligibleTopics(courseId: string) {
  return {
    courseId,
    deletedAt: null,
    reviewStatus: "ACCEPTED" as const,
    name: { not: FALLBACK_TOPIC_NAME },
  };
}

/** The files in a group, as a filter on the course's live files. */
function fileGroupWhere(
  group: FileGroup,
  topics: ReturnType<typeof eligibleTopics>,
): Prisma.CourseMaterialWhereInput {
  if (group.scope === "topic") return { derivedTopics: { some: { topicId: group.topicId } } };
  if (group.scope === "unfiled") return { derivedTopics: { none: { topic: topics } } };
  return {};
}

/** The Settings tab's audience, or the refusal to send instead. */
async function resolveManager(request: Request, courseId: string | undefined) {
  if (!courseId) {
    return { refusal: jsonResponse({ error: "COURSE_ID_REQUIRED" }, 400) };
  }
  const session = await getRequestSession(request);
  if (!session?.user) {
    return { refusal: jsonResponse({ error: "Unauthorized" }, 401) };
  }
  const { course, access } = await resolveCourseAccessGate(session.user, courseId);
  if (!course) {
    return { refusal: jsonResponse({ error: "COURSE_NOT_FOUND" }, 404) };
  }
  if (!access || !canEditCourse(access.level)) {
    return { refusal: jsonResponse({ error: "Forbidden" }, 403) };
  }
  return { course, user: session.user };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const manager = await resolveManager(request, params.id);
      if (manager.refusal) return manager.refusal;
      const { course } = manager;
      const courseId = course.id;

      const topicWhere = eligibleTopics(courseId);
      const liveFiles = { courseId, deletedAt: null };
      // Every live file in a few columns: the Settings tab groups them by topic.
      // Links are read by course rather than per file, so a large course never
      // turns into one query parameter per file.
      const [topics, files, links, exclusions] = await Promise.all([
        prisma.courseTopic.findMany({
          where: topicWhere,
          select: { id: true, name: true, visibleToStudents: true },
          orderBy: { name: "asc" },
        }),
        prisma.courseMaterial.findMany({
          where: liveFiles,
          select: {
            id: true,
            title: true,
            visibleToStudents: true,
            availableAt: true,
            unpublishedAt: true,
            externalId: true,
          },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        }),
        prisma.courseTopicSource.findMany({
          where: { topic: topicWhere, material: liveFiles },
          select: { topicId: true, materialId: true },
        }),
        prisma.canvasMaterialExclusion.findMany({
          where: { courseId },
          select: { canvasFileId: true },
        }),
      ]);

      const topicIdsByFile = new Map<string, string[]>();
      for (const link of links) {
        topicIdsByFile.set(link.materialId, [
          ...(topicIdsByFile.get(link.materialId) ?? []),
          link.topicId,
        ]);
      }
      const excluded = new Set(exclusions.map((row) => row.canvasFileId));

      return jsonResponse({
        studentFilesVisible: course.studentFilesVisible,
        topics,
        files: files.map(({ unpublishedAt, externalId, ...file }) => ({
          ...file,
          topicIds: topicIdsByFile.get(file.id) ?? [],
          // The same Canvas rules as the student gate (studentVisibilityWhere).
          hiddenByCanvas:
            unpublishedAt !== null || (externalId !== null && excluded.has(externalId)),
        })),
      });
    },
    { request },
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "PATCH") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const manager = await resolveManager(request, params.id);
      if (manager.refusal) return manager.refusal;
      const { course, user } = manager;
      const courseId = course.id;

      const parsed = StudentVisibilitySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return jsonResponse({ error: "VALIDATION_ERROR" }, 422);
      }
      const { studentFilesVisible, topics = [], materials = [], fileGroup } = parsed.data;

      const eligible = eligibleTopics(courseId);
      const liveFiles = { courseId, deletedAt: null };
      const saved = await prisma.$transaction(async (tx) => {
        const topicIds = [
          ...topics.map((t) => t.id),
          ...(fileGroup?.scope === "topic" ? [fileGroup.topicId] : []),
        ];
        if (topicIds.length > 0) {
          const found = await tx.courseTopic.count({
            where: { ...eligible, id: { in: [...new Set(topicIds)] } },
          });
          if (found !== new Set(topicIds).size) return { refused: "TOPIC_NOT_ELIGIBLE" as const };
        }
        // Read before writing: each single file's audit entry names what it was.
        const files =
          materials.length > 0
            ? await tx.courseMaterial.findMany({
                where: { ...liveFiles, id: { in: materials.map((m) => m.id) } },
                select: { id: true, title: true, visibleToStudents: true },
              })
            : [];
        if (files.length !== materials.length) return { refused: "MATERIAL_NOT_ELIGIBLE" as const };

        if (studentFilesVisible !== undefined) {
          await tx.course.update({ where: { id: courseId }, data: { studentFilesVisible } });
        }
        for (const visibleToStudents of [true, false]) {
          const changedTopics = topics
            .filter((t) => t.visibleToStudents === visibleToStudents)
            .map((t) => t.id);
          if (changedTopics.length > 0) {
            await tx.courseTopic.updateMany({
              where: { ...eligible, id: { in: changedTopics } },
              data: { visibleToStudents },
            });
          }
          const changedFiles = materials
            .filter((m) => m.visibleToStudents === visibleToStudents)
            .map((m) => m.id);
          if (changedFiles.length > 0) {
            await tx.courseMaterial.updateMany({
              where: { ...liveFiles, id: { in: changedFiles } },
              data: { visibleToStudents },
            });
          }
        }

        if (!fileGroup) return { refused: null, files, group: null };
        const { visibleToStudents } = fileGroup;
        // Only the rows that change, so files already in that state keep their updatedAt.
        const where = {
          ...liveFiles,
          ...fileGroupWhere(fileGroup, eligible),
          visibleToStudents: !visibleToStudents,
        };
        const sample = await tx.courseMaterial.findMany({
          where,
          select: { id: true },
          take: AUDITED_GROUP_IDS,
        });
        const { count: filesChanged } = await tx.courseMaterial.updateMany({
          where,
          data: { visibleToStudents },
        });
        const topicsChanged =
          fileGroup.scope === "all"
            ? (
                await tx.courseTopic.updateMany({
                  where: { ...eligible, visibleToStudents: !visibleToStudents },
                  data: { visibleToStudents },
                })
              ).count
            : 0;
        return {
          refused: null,
          files,
          group: {
            filesChanged,
            topicsChanged,
            changedMaterialIds: sample.map((row) => row.id),
          },
        };
      });
      if (saved.refused) {
        return jsonResponse({ error: saved.refused }, 422);
      }

      // Only once the write has committed: course chat caches topic names, and a
      // read that started earlier must not re-cache a topic hidden just now.
      invalidateCourseTopicNamesCache(courseId);

      const actor = { ...getActorContext(user), ...getRequestContext(request) };
      // Opening a course's files to students is the widest exposure here, so it
      // is on the record, as a single material's visibility change already is.
      if (studentFilesVisible !== undefined || topics.length > 0 || fileGroup) {
        fireAndForget(
          logAuditAction({
            ...actor,
            actionCode: "COURSE_STUDENT_VISIBILITY_UPDATED",
            category: "COURSE",
            entityType: "Course",
            entityId: courseId,
            details:
              fileGroup && saved.group
                ? { studentFilesVisible, topics, fileGroup, ...saved.group }
                : { studentFilesVisible, topics },
          }),
        );
      }
      // One entry per file whose visibility changed, as the Materials tab's
      // per-file control recorded it before (#839).
      for (const file of saved.files) {
        const next = materials.find((m) => m.id === file.id)?.visibleToStudents;
        if (next === undefined || next === file.visibleToStudents) continue;
        fireAndForget(
          logAuditAction({
            ...actor,
            actionCode: "MATERIAL_VISIBILITY_CHANGED",
            category: "MATERIAL",
            entityType: "CourseMaterial",
            entityId: file.id,
            entityLabel: file.title,
            details: {
              courseId,
              previousVisibleToStudents: file.visibleToStudents,
              newVisibleToStudents: next,
            },
          }),
        );
      }

      return jsonResponse({ success: true });
    },
    { request },
  );
}
