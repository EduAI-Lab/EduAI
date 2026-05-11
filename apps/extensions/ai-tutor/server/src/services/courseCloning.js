/**
 * @file Deep-copy course content while remapping topic references into the target course.
 *
 * Responsibility: Clone modules, lessons, and activities from one course tree
 * into another, ensuring every cloned activity points at topic ids owned by
 * the target course rather than the source course.
 * Callers: Instructor course/module import flows and any route that copies
 * existing authored content into another course context.
 * Gotchas:
 *   - Topic remapping is name-based, not id-based, because source and target
 *     courses own different topic rows. Matching target topics are reused and
 *     missing names are created on demand inside the transaction.
 *   - `topicIdMap` caches source-topic-id -> target-topic-id mappings so
 *     repeated activity/topic combinations stay consistent and avoid duplicate
 *     topic creation.
 *   - `targetTopicsByName` is also transaction-scoped so newly-created target
 *     topics are immediately visible to later clones in the same run.
 *   - Main-topic remapping is mandatory; if a source activity references a
 *     topic we cannot resolve, the whole clone aborts rather than creating an
 *     activity with a broken foreign key.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/courses.js`,
 *   `server/src/routes/modules.js`.
 */

import { prisma } from '../config/database.js';

async function ensureTopicMapping(tx, options) {
  const { sourceTopicId, sourceTopicById, topicIdMap, targetTopicsByName, targetCourseId } =
    options;
  if (!sourceTopicId) return null;
  if (topicIdMap.has(sourceTopicId)) {
    return topicIdMap.get(sourceTopicId);
  }

  const sourceTopic = sourceTopicById.get(sourceTopicId);
  if (!sourceTopic) {
    return null;
  }

  let targetTopic = targetTopicsByName.get(sourceTopic.name);
  if (!targetTopic) {
    targetTopic = await tx.topic.create({
      data: {
        name: sourceTopic.name,
        courseOfferingId: targetCourseId,
      },
    });
    targetTopicsByName.set(sourceTopic.name, targetTopic);
  }

  topicIdMap.set(sourceTopicId, targetTopic.id);
  return targetTopic.id;
}

/**
 * Clone course modules and their descendant lessons/activities into another course.
 *
 * @param moduleIds - Optional subset of source modules to import; when omitted,
 * the full source course structure is copied.
 *
 * Why: Cross-course imports need authored content, not source-course foreign
 * keys. This helper recreates the tree so later edits in either course remain
 * isolated while preserving topic semantics through name-based remapping.
 */
export async function cloneCourseContent(sourceCourseId, targetCourseId, options = {}) {
  const { moduleIds = null } = options;

  const sourceModules = await prisma.module.findMany({
    where: {
      courseOfferingId: sourceCourseId,
      ...(Array.isArray(moduleIds) && moduleIds.length > 0 ? { id: { in: moduleIds } } : {}),
    },
    orderBy: { position: 'asc' },
    include: {
      lessons: {
        orderBy: { position: 'asc' },
        include: {
          activities: {
            orderBy: { position: 'asc' },
            include: { secondaryTopics: true },
          },
        },
      },
    },
  });

  if (sourceModules.length === 0) return;

  const sourceTopics = await prisma.topic.findMany({
    where: { courseOfferingId: sourceCourseId },
  });
  const sourceTopicById = new Map(sourceTopics.map((topic) => [topic.id, topic]));

  const maxPosition = await prisma.module.aggregate({
    where: { courseOfferingId: targetCourseId },
    _max: { position: true },
  });
  let nextModulePosition = maxPosition._max.position ?? 0;

  await prisma.$transaction(async (tx) => {
    const existingTargetTopics = await tx.topic.findMany({
      where: { courseOfferingId: targetCourseId },
    });
    const targetTopicsByName = new Map(existingTargetTopics.map((topic) => [topic.name, topic]));
    const topicIdMap = new Map();

    for (const module of sourceModules) {
      nextModulePosition += 1;
      const createdModule = await tx.module.create({
        data: {
          title: module.title,
          description: module.description,
          position: nextModulePosition,
          courseOfferingId: targetCourseId,
        },
      });

      for (const lesson of module.lessons) {
        const createdLesson = await tx.lesson.create({
          data: {
            title: lesson.title,
            contentMd: lesson.contentMd,
            position: lesson.position,
            moduleId: createdModule.id,
          },
        });

        for (const activity of lesson.activities) {
          // Activity topic foreign keys must always point at the target course,
          // even when the source and target happened to start from the same import.
          const targetMainTopicId = await ensureTopicMapping(tx, {
            sourceTopicId: activity.mainTopicId,
            sourceTopicById,
            topicIdMap,
            targetTopicsByName,
            targetCourseId,
          });

          if (!targetMainTopicId) {
            throw new Error('Failed to map main topic while cloning activity.');
          }

          const mappedSecondaryIds = [];
          for (const relation of activity.secondaryTopics) {
            const mapped = await ensureTopicMapping(tx, {
              sourceTopicId: relation.topicId,
              sourceTopicById,
              topicIdMap,
              targetTopicsByName,
              targetCourseId,
            });
            if (mapped) {
              mappedSecondaryIds.push(mapped);
            }
          }

          await tx.activity.create({
            data: {
              title: activity.title,
              instructionsMd: activity.instructionsMd,
              position: activity.position,
              lessonId: createdLesson.id,
              promptTemplateId: activity.promptTemplateId,
              config: activity.config,
              mainTopicId: targetMainTopicId,
              secondaryTopics:
                mappedSecondaryIds.length > 0
                  ? {
                      create: mappedSecondaryIds.map((topicId) => ({
                        topic: { connect: { id: topicId } },
                      })),
                    }
                  : undefined,
            },
          });
        }
      }
    }
  });
}

/**
 * Clone selected lessons into an existing target module.
 *
 * Why: Lesson-level imports reuse the same topic-remapping contract as
 * course-level cloning so imported activities can safely reference the target
 * module's course topics without leaking source-course ids.
 */
export async function cloneLessonsFromOffering(sourceLessonIds, targetModuleId) {
  const targetModule = await prisma.module.findUnique({
    where: { id: targetModuleId },
    select: { courseOfferingId: true },
  });
  if (!targetModule) return;

  const lessons = await prisma.lesson.findMany({
    where: { id: { in: sourceLessonIds } },
    orderBy: { position: 'asc' },
    include: {
      module: { select: { courseOfferingId: true } },
      activities: {
        orderBy: { position: 'asc' },
        include: { secondaryTopics: true },
      },
    },
  });

  if (lessons.length === 0) return;

  const sourceCourseIds = new Set(
    lessons
      .map((lesson) => lesson.module.courseOfferingId)
      .filter((value) => Number.isInteger(value)),
  );

  const sourceTopicById = new Map();
  for (const courseId of sourceCourseIds) {
    const topics = await prisma.topic.findMany({ where: { courseOfferingId: courseId } });
    for (const topic of topics) {
      sourceTopicById.set(topic.id, topic);
    }
  }

  const maxPosition = await prisma.lesson.aggregate({
    where: { moduleId: targetModuleId },
    _max: { position: true },
  });
  let nextLessonPosition = maxPosition._max.position ?? 0;

  await prisma.$transaction(async (tx) => {
    const existingTargetTopics = await tx.topic.findMany({
      where: { courseOfferingId: targetModule.courseOfferingId },
    });
    const targetTopicsByName = new Map(existingTargetTopics.map((topic) => [topic.name, topic]));
    const topicIdMap = new Map();

    for (const lesson of lessons) {
      nextLessonPosition += 1;
      const createdLesson = await tx.lesson.create({
        data: {
          title: lesson.title,
          contentMd: lesson.contentMd,
          position: nextLessonPosition,
          moduleId: targetModuleId,
        },
      });

      for (const activity of lesson.activities) {
        // Lessons can originate from multiple source courses, so the mapping
        // cache is keyed by source topic id and normalized onto the target course.
        const targetMainTopicId = await ensureTopicMapping(tx, {
          sourceTopicId: activity.mainTopicId,
          sourceTopicById,
          topicIdMap,
          targetTopicsByName,
          targetCourseId: targetModule.courseOfferingId,
        });

        if (!targetMainTopicId) {
          throw new Error('Failed to map main topic while cloning activity.');
        }

        const mappedSecondaryIds = [];
        for (const relation of activity.secondaryTopics) {
          const mapped = await ensureTopicMapping(tx, {
            sourceTopicId: relation.topicId,
            sourceTopicById,
            topicIdMap,
            targetTopicsByName,
            targetCourseId: targetModule.courseOfferingId,
          });
          if (mapped) {
            mappedSecondaryIds.push(mapped);
          }
        }

        await tx.activity.create({
          data: {
            title: activity.title,
            instructionsMd: activity.instructionsMd,
            position: activity.position,
            lessonId: createdLesson.id,
            promptTemplateId: activity.promptTemplateId,
            config: activity.config,
            mainTopicId: targetMainTopicId,
            secondaryTopics:
              mappedSecondaryIds.length > 0
                ? {
                    create: mappedSecondaryIds.map((topicId) => ({
                      topic: { connect: { id: topicId } },
                    })),
                  }
                : undefined,
          },
        });
      }
    }
  });
}
