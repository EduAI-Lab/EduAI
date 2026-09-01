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
 *     missing names are created in one batch before any activity is written.
 *   - The whole tree is written level by level with `createManyAndReturn`, so a
 *     clone costs a fixed number of statements instead of one per node. Each
 *     level maps parents to children by position in the returned array, and
 *     since Prisma guarantees no ordering there, the returned rows are sorted
 *     back into input order by autoincrement id first. See
 *     `correlateCreatedRows`.
 *   - Main-topic remapping is mandatory; if a source activity references a
 *     topic we cannot resolve, the whole clone aborts rather than creating an
 *     activity with a broken foreign key.
 *   - Source reads deliberately happen outside the transaction so the write
 *     transaction holds its row locks for as short a window as possible.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/courses.js`,
 *   `server/src/routes/modules.js`.
 */

import { Prisma } from "@eduai/ai-tutor-prisma-client";

import { prisma } from "../config/database.js";

// A clone writes a handful of large inserts rather than many small ones, but a
// deep tree can still outrun Prisma's 5s interactive-transaction default.
export const CLONE_TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Run the clone writes in a transaction, or inline when the caller already owns one.
 *
 * Why: Course imports wrap several clones in a single outer transaction so a
 * failed import leaves nothing behind. A transaction client has no
 * `$transaction` of its own, so nesting has to reuse the caller's instead.
 */
async function runInCloneTransaction(db, operation) {
  if (typeof db.$transaction === "function") {
    return db.$transaction(operation, { timeout: CLONE_TRANSACTION_TIMEOUT_MS });
  }
  return operation(db);
}

/**
 * Collect every source topic id referenced anywhere under the given lessons.
 *
 * Why: The topic mapping is resolved once up front, so it needs the full set of
 * ids before the first write instead of discovering them activity by activity.
 */
function collectSourceTopicIds(lessons) {
  const sourceTopicIds = new Set();

  for (const lesson of lessons) {
    for (const activity of lesson.activities) {
      if (activity.mainTopicId) {
        sourceTopicIds.add(activity.mainTopicId);
      }
      for (const relation of activity.secondaryTopics) {
        if (relation.topicId) {
          sourceTopicIds.add(relation.topicId);
        }
      }
    }
  }

  return sourceTopicIds;
}

/**
 * Resolve every source topic id to a topic id owned by the target course.
 *
 * Why: One read plus one insert replaces the per-activity round-trips the clone
 * used to make. Names missing from the target are created in a single batch;
 * source ids we cannot resolve are simply absent from the returned map, which
 * callers treat the same way the old per-topic helper treated a null return.
 */
async function buildTopicIdMap(tx, options) {
  const { sourceTopicIds, sourceTopicById, targetCourseId } = options;
  const topicIdMap = new Map();
  if (sourceTopicIds.size === 0) return topicIdMap;

  const existingTargetTopics = await tx.topic.findMany({
    where: { courseOfferingId: targetCourseId },
    select: { id: true, name: true },
  });
  const targetTopicIdByName = new Map(existingTargetTopics.map((topic) => [topic.name, topic.id]));

  // Distinct source ids can share a name, and `Topic` is unique on
  // (courseOfferingId, name), so the insert has to be deduped by name.
  const missingNames = new Set();
  for (const sourceTopicId of sourceTopicIds) {
    const sourceTopic = sourceTopicById.get(sourceTopicId);
    if (!sourceTopic) continue;
    if (targetTopicIdByName.has(sourceTopic.name)) continue;
    missingNames.add(sourceTopic.name);
  }

  if (missingNames.size > 0) {
    const createdTopics = await tx.topic.createManyAndReturn({
      data: Array.from(missingNames, (name) => ({ name, courseOfferingId: targetCourseId })),
      select: { id: true, name: true },
    });
    for (const topic of createdTopics) {
      targetTopicIdByName.set(topic.name, topic.id);
    }
  }

  for (const sourceTopicId of sourceTopicIds) {
    const sourceTopic = sourceTopicById.get(sourceTopicId);
    if (!sourceTopic) continue;
    const targetTopicId = targetTopicIdByName.get(sourceTopic.name);
    if (targetTopicId) {
      topicIdMap.set(sourceTopicId, targetTopicId);
    }
  }

  return topicIdMap;
}

/**
 * Write every activity under already-created target lessons, plus their
 * secondary-topic join rows.
 *
 * @param lessonBuckets - `[{ lessonId, activities }]` pairing each new target
 * lesson id with the source activities that belong under it.
 *
 * Why: Both entry points end at the same activity-shaped work, and both need
 * the main-topic check to fire before anything is inserted so a broken mapping
 * aborts the clone instead of leaving a half-written tree behind.
 */
async function createActivitiesForLessons(tx, lessonBuckets, topicIdMap) {
  const activityRows = [];
  const sourceActivities = [];

  for (const { lessonId, activities } of lessonBuckets) {
    for (const activity of activities) {
      // Activity topic foreign keys must always point at the target course,
      // even when the source and target happened to start from the same import.
      const targetMainTopicId = topicIdMap.get(activity.mainTopicId);
      if (!targetMainTopicId) {
        throw new Error("Failed to map main topic while cloning activity.");
      }

      activityRows.push({
        title: activity.title,
        instructionsMd: activity.instructionsMd,
        position: activity.position,
        lessonId,
        promptTemplateId: activity.promptTemplateId,
        customPrompt: activity.customPrompt,
        customPromptTitle: activity.customPromptTitle,
        // A bare JS null is ambiguous for a Json column, so an absent source
        // config has to be spelled out as a database NULL.
        config: activity.config === null ? Prisma.DbNull : activity.config,
        mainTopicId: targetMainTopicId,
        enableTeachMode: activity.enableTeachMode,
        enableGuideMode: activity.enableGuideMode,
        enableCustomMode: activity.enableCustomMode,
      });
      sourceActivities.push(activity);
    }
  }

  if (activityRows.length === 0) return;

  const createdActivities = correlateCreatedRows(
    await tx.activity.createManyAndReturn({
      data: activityRows,
      select: { id: true },
    }),
    activityRows,
    "activities",
  );

  const joinRows = [];
  const seenPairs = new Set();
  for (const [index, sourceActivity] of sourceActivities.entries()) {
    const activityId = createdActivities[index].id;
    for (const relation of sourceActivity.secondaryTopics) {
      const topicId = topicIdMap.get(relation.topicId);
      if (!topicId) continue;
      const pairKey = `${activityId}:${topicId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      joinRows.push({ activityId, topicId });
    }
  }

  if (joinRows.length > 0) {
    await tx.activitySecondaryTopic.createMany({ data: joinRows });
  }
}

/**
 * Restore the input ordering of rows returned by a `createManyAndReturn`.
 *
 * Why: Every level maps parents to children by array position, but Prisma does
 * not document any ordering guarantee for `createManyAndReturn`, so a permuted
 * return would silently attach children to the wrong parent. Autoincrement ids
 * are drawn from the sequence in `VALUES` order, so sorting the returned rows
 * by id reconstructs the input order even if the driver hands them back
 * shuffled. The row count is still asserted, since a short return cannot be
 * repaired by sorting.
 */
function correlateCreatedRows(created, requested, label) {
  if (created.length !== requested.length) {
    throw new Error(
      `Clone wrote ${created.length} ${label} but expected ${requested.length}; aborting.`,
    );
  }
  return created.toSorted((a, b) => a.id - b.id);
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
export async function cloneCourseContent(
  sourceCourseId,
  targetCourseId,
  options = {},
  db = prisma,
) {
  const { moduleIds = null } = options;

  const sourceModules = await db.module.findMany({
    where: {
      courseOfferingId: sourceCourseId,
      // No explicit selection clones every module; `undefined` is Prisma's
      // "no constraint".
      id: Array.isArray(moduleIds) && moduleIds.length > 0 ? { in: moduleIds } : undefined,
    },
    orderBy: { position: "asc" },
    include: {
      lessons: {
        orderBy: { position: "asc" },
        include: {
          activities: {
            orderBy: { position: "asc" },
            include: { secondaryTopics: true },
          },
        },
      },
    },
  });

  if (sourceModules.length === 0) return;

  // Independent reads, so they go out together rather than costing two round trips.
  const [sourceTopics, maxPosition] = await Promise.all([
    db.topic.findMany({ where: { courseOfferingId: sourceCourseId } }),
    db.module.aggregate({
      where: { courseOfferingId: targetCourseId },
      _max: { position: true },
    }),
  ]);
  const sourceTopicById = new Map(sourceTopics.map((topic) => [topic.id, topic]));
  let nextModulePosition = maxPosition._max.position ?? 0;

  const moduleRows = sourceModules.map((module) => {
    nextModulePosition += 1;
    return {
      title: module.title,
      description: module.description,
      position: nextModulePosition,
      courseOfferingId: targetCourseId,
    };
  });

  const sourceLessons = sourceModules.flatMap((module) => module.lessons);
  const sourceTopicIds = collectSourceTopicIds(sourceLessons);

  await runInCloneTransaction(db, async (tx) => {
    const topicIdMap = await buildTopicIdMap(tx, {
      sourceTopicIds,
      sourceTopicById,
      targetCourseId,
    });

    const createdModules = correlateCreatedRows(
      await tx.module.createManyAndReturn({
        data: moduleRows,
        select: { id: true },
      }),
      moduleRows,
      "modules",
    );

    const lessonRows = [];
    const lessonSources = [];
    for (const [index, module] of sourceModules.entries()) {
      const moduleId = createdModules[index].id;
      for (const lesson of module.lessons) {
        lessonRows.push({
          title: lesson.title,
          contentMd: lesson.contentMd,
          position: lesson.position,
          moduleId,
        });
        lessonSources.push(lesson);
      }
    }

    if (lessonRows.length === 0) return;

    const createdLessons = correlateCreatedRows(
      await tx.lesson.createManyAndReturn({
        data: lessonRows,
        select: { id: true },
      }),
      lessonRows,
      "lessons",
    );

    await createActivitiesForLessons(
      tx,
      lessonSources.map((lesson, index) => ({
        lessonId: createdLessons[index].id,
        activities: lesson.activities,
      })),
      topicIdMap,
    );
  });
}

/**
 * Clone selected lessons into an existing target module.
 *
 * Why: Lesson-level imports reuse the same topic-remapping contract as
 * course-level cloning so imported activities can safely reference the target
 * module's course topics without leaking source-course ids.
 */
export async function cloneLessonsFromOffering(sourceLessonIds, targetModuleId, db = prisma) {
  const targetModule = await db.module.findUnique({
    where: { id: targetModuleId },
    select: { courseOfferingId: true },
  });
  if (!targetModule) return;

  const lessons = await db.lesson.findMany({
    where: { id: { in: sourceLessonIds } },
    orderBy: { position: "asc" },
    include: {
      module: { select: { courseOfferingId: true } },
      activities: {
        orderBy: { position: "asc" },
        include: { secondaryTopics: true },
      },
    },
  });

  if (lessons.length === 0) return;

  // Lessons can originate from multiple source courses, so every source course's
  // topics are loaded in one read and normalized onto the target course below.
  const sourceCourseIds = Array.from(
    new Set(
      lessons
        .map((lesson) => lesson.module.courseOfferingId)
        .filter((value) => Number.isInteger(value)),
    ),
  );

  // Independent reads, so they go out together rather than costing two round trips.
  const [sourceTopics, maxPosition] = await Promise.all([
    sourceCourseIds.length > 0
      ? db.topic.findMany({ where: { courseOfferingId: { in: sourceCourseIds } } })
      : [],
    db.lesson.aggregate({
      where: { moduleId: targetModuleId },
      _max: { position: true },
    }),
  ]);
  const sourceTopicById = new Map(sourceTopics.map((topic) => [topic.id, topic]));
  let nextLessonPosition = maxPosition._max.position ?? 0;

  const lessonRows = lessons.map((lesson) => {
    nextLessonPosition += 1;
    return {
      title: lesson.title,
      contentMd: lesson.contentMd,
      position: nextLessonPosition,
      moduleId: targetModuleId,
    };
  });

  const sourceTopicIds = collectSourceTopicIds(lessons);

  await runInCloneTransaction(db, async (tx) => {
    const topicIdMap = await buildTopicIdMap(tx, {
      sourceTopicIds,
      sourceTopicById,
      targetCourseId: targetModule.courseOfferingId,
    });

    const createdLessons = correlateCreatedRows(
      await tx.lesson.createManyAndReturn({
        data: lessonRows,
        select: { id: true },
      }),
      lessonRows,
      "lessons",
    );

    await createActivitiesForLessons(
      tx,
      lessons.map((lesson, index) => ({
        lessonId: createdLessons[index].id,
        activities: lesson.activities,
      })),
      topicIdMap,
    );
  });
}
