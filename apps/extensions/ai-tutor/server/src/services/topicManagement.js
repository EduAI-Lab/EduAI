/**
 * Course-topic authorization and remapping.
 *
 * The topic routes remain HTTP adapters; this module owns course membership,
 * mapping normalization, and the transactional main/secondary-topic rewrite.
 */

import { prisma } from '../config/database.js';
import { isCourseAdmin } from '../middleware/auth.js';
import { TopicRemapSchema } from '../../../shared/schemas/mutations.js';

export class TopicMutationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'TopicMutationError';
    this.status = status;
    if (code) this.code = code;
  }
}

const ID_CHUNK_SIZE = 5000;

function chunkIds(ids, size = ID_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Shared course membership lookup used by topic list/create routes. */
export async function ensureCourseTopicAccess(courseId, user) {
  const userId = user?.id;
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: {
      instructors: true,
      enrollments: true,
    },
  });

  if (!course) return { course: null, authorized: false };

  const isInstructor = course.instructors.some((assignment) => assignment.userId === userId);
  const isStudent = course.enrollments.some((enrollment) => enrollment.userId === userId);
  const isAdmin = user?.role === 'ADMIN';
  return { course, authorized: isAdmin || isInstructor || isStudent, isInstructor };
}

async function preloadSecondaryTopics(tx, courseId, normalized) {
  const fromTopicIds = normalized.map((mapping) => mapping.fromTopicId);
  const toTopicIds = new Set(normalized.map((mapping) => mapping.toTopicId));
  const independent =
    new Set(fromTopicIds).size === fromTopicIds.length &&
    !fromTopicIds.some((id) => toTopicIds.has(id));
  if (!independent) return null;

  const sourceRows = await tx.activitySecondaryTopic.findMany({
    where: {
      topicId: { in: fromTopicIds },
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    },
    select: { activityId: true, topicId: true },
  });
  const sourceByTopic = new Map();
  const allActivityIds = new Set();
  for (const row of sourceRows) {
    if (!sourceByTopic.has(row.topicId)) sourceByTopic.set(row.topicId, new Set());
    sourceByTopic.get(row.topicId).add(row.activityId);
    allActivityIds.add(row.activityId);
  }

  const targetByTopic = new Map();
  for (const activityIds of chunkIds(Array.from(allActivityIds))) {
    const targetRows = await tx.activitySecondaryTopic.findMany({
      where: {
        topicId: { in: Array.from(toTopicIds) },
        activityId: { in: activityIds },
      },
      select: { activityId: true, topicId: true },
    });
    for (const row of targetRows) {
      if (!targetByTopic.has(row.topicId)) targetByTopic.set(row.topicId, new Set());
      targetByTopic.get(row.topicId).add(row.activityId);
    }
  }
  return { sourceByTopic, targetByTopic };
}

function parseMappings(body = {}) {
  const parsed = TopicRemapSchema.safeParse(body);
  if (!parsed.success) throw new TopicMutationError('No valid mappings provided');
  return parsed.data.mappings;
}

/** Rewrite all activity references for a course in one serializable transaction. */
export async function remapCourseTopics({ courseId, user, body }) {
  const normalized = parseMappings(body);
  const course = await prisma.courseOffering.findUnique({
    where: { id: courseId },
    include: { instructors: { select: { userId: true } } },
  });
  if (!course) throw new TopicMutationError('Course not found', 404);
  if (!(await isCourseAdmin(user, course))) {
    throw new TopicMutationError('Not authorized for this course', 403);
  }

  await prisma.$transaction(
    async (tx) => {
      const allTopicIds = Array.from(
        new Set(normalized.flatMap((mapping) => [mapping.fromTopicId, mapping.toTopicId])),
      );
      const ownedTopics = await tx.topic.findMany({
        where: { id: { in: allTopicIds }, courseOfferingId: courseId },
        select: { id: true },
      });
      const ownedTopicIds = new Set(ownedTopics.map((topic) => topic.id));
      const deletedTopicIds = new Set();
      const isUsable = (id) => ownedTopicIds.has(id) && !deletedTopicIds.has(id);

      for (const { fromTopicId, toTopicId } of normalized) {
        if (!ownedTopicIds.has(fromTopicId)) {
          throw new Error('fromTopicId does not belong to this course');
        }
        if (!ownedTopicIds.has(toTopicId)) {
          throw new Error('toTopicId does not belong to this course');
        }
      }

      const deleteTopicIfUnused = async (ids) => {
        if (ids.length === 0) return;
        for (const chunk of chunkIds(ids)) {
          const { count } = await tx.topic.deleteMany({
            where: { id: { in: chunk }, mainActivities: { none: {} } },
          });
          if (count === chunk.length) {
            for (const id of chunk) deletedTopicIds.add(id);
          } else {
            const left = await tx.topic.findMany({
              where: { id: { in: chunk } },
              select: { id: true },
            });
            const survived = new Set(left.map((topic) => topic.id));
            for (const id of chunk) if (!survived.has(id)) deletedTopicIds.add(id);
          }
        }
      };

      const preloaded = await preloadSecondaryTopics(tx, courseId, normalized);
      if (preloaded) {
        const fromTopicIds = normalized.map((mapping) => mapping.fromTopicId);
        const createRows = [];
        const queuedRows = new Set();
        const sourceActivityIds = new Set();

        for (const { fromTopicId, toTopicId } of normalized) {
          await tx.activity.updateMany({
            where: {
              mainTopicId: fromTopicId,
              lesson: { module: { courseOfferingId: courseId } },
            },
            data: { mainTopicId: toTopicId },
          });
          const have = preloaded.targetByTopic.get(toTopicId) ?? new Set();
          for (const activityId of preloaded.sourceByTopic.get(fromTopicId) ?? []) {
            sourceActivityIds.add(activityId);
            const key = `${activityId}\u0000${toTopicId}`;
            if (have.has(activityId) || queuedRows.has(key)) continue;
            queuedRows.add(key);
            createRows.push({ activityId, topicId: toTopicId });
          }
        }

        if (createRows.length > 0) {
          await tx.activitySecondaryTopic.createMany({ data: createRows, skipDuplicates: true });
        }
        for (const activityIds of chunkIds(Array.from(sourceActivityIds))) {
          await tx.activitySecondaryTopic.deleteMany({
            where: { topicId: { in: fromTopicIds }, activityId: { in: activityIds } },
          });
        }
        await deleteTopicIfUnused(fromTopicIds);
        return;
      }

      for (const { fromTopicId, toTopicId } of normalized) {
        if (!isUsable(fromTopicId)) {
          throw new Error('fromTopicId does not belong to this course');
        }
        if (!isUsable(toTopicId)) {
          throw new Error('toTopicId does not belong to this course');
        }
        await tx.activity.updateMany({
          where: {
            mainTopicId: fromTopicId,
            lesson: { module: { courseOfferingId: courseId } },
          },
          data: { mainTopicId: toTopicId },
        });

        const secondary = await tx.activitySecondaryTopic.findMany({
          where: {
            topicId: fromTopicId,
            activity: { lesson: { module: { courseOfferingId: courseId } } },
          },
          select: { activityId: true },
        });
        const activityIds = Array.from(new Set(secondary.map((row) => row.activityId)));
        for (const chunk of chunkIds(activityIds)) {
          const existingTarget = await tx.activitySecondaryTopic.findMany({
            where: { topicId: toTopicId, activityId: { in: chunk } },
            select: { activityId: true },
          });
          const have = new Set(existingTarget.map((row) => row.activityId));
          const toCreate = chunk.filter((id) => !have.has(id));
          if (toCreate.length > 0) {
            await tx.activitySecondaryTopic.createMany({
              data: toCreate.map((id) => ({ activityId: id, topicId: toTopicId })),
              skipDuplicates: true,
            });
          }
          await tx.activitySecondaryTopic.deleteMany({
            where: { topicId: fromTopicId, activityId: { in: chunk } },
          });
        }
        await deleteTopicIfUnused([fromTopicId]);
      }
    },
    { isolationLevel: 'Serializable' },
  );
}
