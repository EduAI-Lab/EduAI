/**
 * @file Clone an existing Activity into a (possibly different) Lesson.
 *
 * Responsibility: Shared core for "duplicate activity in place" and
 *   "import activity from another lesson" — both need the same copy +
 *   topic-remapping + position logic, differing only in which lesson (and
 *   therefore which course) the clone lands in.
 * Callers: `routes/activities.js` (`POST /activities/:activityId/duplicate`,
 *   `POST /lessons/:lessonId/activities/import`).
 * Gotchas:
 *   - `Activity.mainTopicId` (and secondary topic ids) must belong to the
 *     SAME course as the lesson (see schema.prisma comment on Activity).
 *     When cloning across courses, source topics are remapped by name onto
 *     the target course, reusing an existing topic if one with the same name
 *     exists, else creating it — mirrors `services/courseCloning.js`.
 *   - When source and target course are the same (duplicate-in-place, or an
 *     import between two lessons of the same course), topic ids are reused
 *     as-is; no new Topic rows are created.
 *   - Position is computed as `max(existing activity positions in target
 *     lesson) + 1` so the clone always lands last, matching how
 *     `courseCloning.js` orders cloned modules/lessons.
 * Related: `services/courseCloning.js` (same remap pattern at the
 *   module/lesson level), `prisma/schema.prisma` (Activity model).
 */

import { prisma } from '../config/database.js';

async function resolveTargetTopicId(tx, sourceTopic, targetCourseOfferingId) {
  if (!sourceTopic) return null;
  if (sourceTopic.courseOfferingId === targetCourseOfferingId) {
    return sourceTopic.id;
  }

  const existing = await tx.topic.findFirst({
    where: { courseOfferingId: targetCourseOfferingId, name: sourceTopic.name },
  });
  if (existing) return existing.id;

  const created = await tx.topic.create({
    data: { name: sourceTopic.name, courseOfferingId: targetCourseOfferingId },
  });
  return created.id;
}

/**
 * Clone `sourceActivity` (with `mainTopic` and `secondaryTopics.topic`
 * eagerly loaded) into `targetLessonId`, which belongs to
 * `targetCourseOfferingId`.
 *
 * Returns the newly created Activity row with the same relation shape
 * `mapActivity` expects (`promptTemplate`, `mainTopic`, `secondaryTopics.topic`).
 */
export async function cloneActivityIntoLesson({
  sourceActivity,
  targetLessonId,
  targetCourseOfferingId,
}) {
  return prisma.$transaction(async (tx) => {
    const maxPosition = await tx.activity.aggregate({
      where: { lessonId: targetLessonId },
      _max: { position: true },
    });
    const position = (maxPosition._max.position ?? 0) + 1;

    const targetMainTopicId = await resolveTargetTopicId(
      tx,
      sourceActivity.mainTopic,
      targetCourseOfferingId,
    );
    if (!targetMainTopicId) {
      throw new Error('Failed to resolve main topic while cloning activity.');
    }

    const secondaryTopicIds = [];
    for (const relation of sourceActivity.secondaryTopics ?? []) {
      const mapped = await resolveTargetTopicId(tx, relation.topic, targetCourseOfferingId);
      if (mapped && mapped !== targetMainTopicId) {
        secondaryTopicIds.push(mapped);
      }
    }
    const uniqueSecondaryIds = Array.from(new Set(secondaryTopicIds));

    return tx.activity.create({
      data: {
        title: sourceActivity.title,
        instructionsMd: sourceActivity.instructionsMd,
        config: sourceActivity.config,
        position,
        lessonId: targetLessonId,
        promptTemplateId: sourceActivity.promptTemplateId,
        customPrompt: sourceActivity.customPrompt,
        customPromptTitle: sourceActivity.customPromptTitle,
        mainTopicId: targetMainTopicId,
        enableTeachMode: sourceActivity.enableTeachMode,
        enableGuideMode: sourceActivity.enableGuideMode,
        enableCustomMode: sourceActivity.enableCustomMode,
        secondaryTopics:
          uniqueSecondaryIds.length > 0
            ? {
                create: uniqueSecondaryIds.map((topicId) => ({
                  topic: { connect: { id: topicId } },
                })),
              }
            : undefined,
      },
      include: {
        promptTemplate: { select: { id: true, name: true } },
        mainTopic: true,
        secondaryTopics: { include: { topic: true } },
      },
    });
  });
}
