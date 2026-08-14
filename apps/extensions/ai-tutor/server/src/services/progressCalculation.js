// NB: the client is generated to a custom output (see `generator client` in
// schema.prisma), so `Prisma` must come from there — importing it from
// '@prisma/client' resolves to a different module whose `Prisma.join` is undefined.
import { Prisma } from '@eduai/ai-tutor-prisma-client';
import { prisma } from '../config/database.js';

/** Progress shape returned when there is nothing to compute. */
const EMPTY_PROGRESS = { completed: 0, total: 0, percentage: 0 };

/**
 * Prisma `where` fragment for "activity's lesson AND that lesson's module are
 * both published" — the denominator predicate for course/module/lesson
 * progress. Centralized so the three `findMany` calls below can't drift apart
 * the way they did before #1187. The raw SQL in `calculateCourseProgressBatch`
 * can't spread this (it's a different query engine) — if you change this
 * fragment, update that JOIN's ON clauses too.
 */
const PUBLISHED_LESSON_WHERE = { isPublished: true, module: { isPublished: true } };

/**
 * Bucket a progress record the way the course-list Progress filter does.
 *
 * Why here: `PROGRESS_FILTER` in `app/routes/student.tsx` is the definition of
 * record for these buckets, and `GET /api/courses?progress=` must agree with it
 * exactly or the filter returns courses the UI would have labelled differently.
 * Unit tests on both sides pin them to the same four cases (#1208).
 *
 * @returns {'not-started'|'in-progress'|'completed'|null} null = no published
 *   activities, so the course sits in no bucket and any progress filter excludes it.
 */
export function progressBucket(progress) {
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  if (total <= 0) return null;
  if (completed <= 0) return 'not-started';
  if (completed >= total) return 'completed';
  return 'in-progress';
}

/**
 * Batched course progress — TWO set-based queries for any number of courses.
 *
 * Why: `calculateCourseProgress` runs 2 queries *per course*. That was tolerable
 * when only the current page needed progress, but `?progress=` (#1208) has to
 * bucket the caller's entire accessible set before paging, which would turn the
 * documented N+1 into an N+1 over everything. This replaces both uses.
 *
 * Semantics are identical to `calculateCourseProgress`, which the unit tests
 * assert directly against this function on shared fixtures:
 *   total     = activities in published lessons in published modules
 *   completed = of those, the ones with ANY submission by this user ever
 *               `isCorrect = true` (sticky — #1187 — a later wrong
 *               re-attempt does not undo completion)
 *   total 0   → { completed: 0, total: 0, percentage: 0 }
 *
 * @param {number[]} courseIds CourseOffering ids.
 * @param {string} userId
 * @returns {Promise<Map<number, { completed: number, total: number, percentage: number }>>}
 *   Every requested id is present; courses with no published activities map to zeroes.
 */
export async function calculateCourseProgressBatch(courseIds, userId) {
  const ids = Array.from(new Set((courseIds ?? []).filter((id) => Number.isInteger(id))));
  const result = new Map(ids.map((id) => [id, { ...EMPTY_PROGRESS }]));
  if (ids.length === 0 || !userId) return result;

  try {
    const idList = Prisma.join(ids);

    // Published activities per course. COUNT(*)::int keeps this a JS number —
    // an un-cast COUNT comes back as BigInt and breaks the arithmetic below.
    // The two `AND ... "isPublished" = true` clauses are PUBLISHED_LESSON_WHERE's
    // predicate, hand-written for raw SQL — keep them in sync with that fragment.
    const totals = await prisma.$queryRaw`
      SELECT m."courseOfferingId" AS "courseId", COUNT(*)::int AS "count"
      FROM "Activity" a
      JOIN "Lesson" l ON l.id = a."lessonId" AND l."isPublished" = true
      JOIN "Module" m ON m.id = l."moduleId" AND m."isPublished" = true
      WHERE m."courseOfferingId" IN (${idList})
      GROUP BY m."courseOfferingId"
    `;

    // Of those, the ones with ANY submission by this user ever correct —
    // sticky (#1187), the set-based equivalent of `countCompletedActivities`'s
    // `distinct: ['activityId']` over `isCorrect: true` submissions. A later
    // incorrect re-attempt must not undo completion.
    const completed = await prisma.$queryRaw`
      WITH scoped AS (
        SELECT a.id AS "activityId", m."courseOfferingId" AS "courseId"
        FROM "Activity" a
        JOIN "Lesson" l ON l.id = a."lessonId" AND l."isPublished" = true
        JOIN "Module" m ON m.id = l."moduleId" AND m."isPublished" = true
        WHERE m."courseOfferingId" IN (${idList})
      )
      SELECT scoped."courseId" AS "courseId", COUNT(DISTINCT scoped."activityId")::int AS "count"
      FROM scoped
      JOIN "Submission" s ON s."activityId" = scoped."activityId"
        AND s."userId" = ${userId}
        AND s."isCorrect" = true
      GROUP BY scoped."courseId"
    `;

    const completedByCourse = new Map(completed.map((r) => [r.courseId, r.count]));
    for (const row of totals) {
      const total = row.count;
      if (total <= 0) continue;
      const done = completedByCourse.get(row.courseId) ?? 0;
      result.set(row.courseId, {
        completed: done,
        total,
        percentage: Math.round((done / total) * 100),
      });
    }
    return result;
  } catch (error) {
    console.error('Error calculating batched course progress:', error);
    return result;
  }
}

/**
 * Calculate progress for a course based on correct submissions
 * Progress = (# activities with any correct submission, sticky (#1187)) / (# published activities)
 * Only counts activities in published lessons in published modules
 */
export async function calculateCourseProgress(courseId, userId) {
  if (!courseId || !userId) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  try {
    // Find all published activity IDs in this course
    const activities = await prisma.activity.findMany({
      where: {
        lesson: {
          ...PUBLISHED_LESSON_WHERE,
          module: { ...PUBLISHED_LESSON_WHERE.module, courseOfferingId: courseId },
        },
      },
      select: { id: true },
    });

    const activityIds = activities.map((a) => a.id);
    const totalActivities = activityIds.length;

    if (totalActivities === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    // Get completion count
    const completedCount = await countCompletedActivities(activityIds, userId);

    return {
      completed: completedCount,
      total: totalActivities,
      percentage: Math.round((completedCount / totalActivities) * 100),
    };
  } catch (error) {
    console.error('Error calculating course progress:', error);
    return { completed: 0, total: 0, percentage: 0 };
  }
}

/**
 * Calculate progress for a module based on correct submissions
 * Only counts activities in published lessons, in this module if it is
 * itself published — matches the course-scope filter (#1187) so the same
 * activity is never counted at module scope but excluded at course scope.
 */
export async function calculateModuleProgress(moduleId, userId) {
  if (!moduleId || !userId) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  try {
    // Find all published activity IDs in this module
    const activities = await prisma.activity.findMany({
      where: {
        lesson: { ...PUBLISHED_LESSON_WHERE, moduleId },
      },
      select: { id: true },
    });

    const activityIds = activities.map((a) => a.id);
    const totalActivities = activityIds.length;

    if (totalActivities === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    // Get completion count
    const completedCount = await countCompletedActivities(activityIds, userId);

    return {
      completed: completedCount,
      total: totalActivities,
      percentage: Math.round((completedCount / totalActivities) * 100),
    };
  } catch (error) {
    console.error('Error calculating module progress:', error);
    return { completed: 0, total: 0, percentage: 0 };
  }
}

/**
 * Calculate progress for a lesson based on correct submissions
 * Only counts activities if this lesson and its module are published —
 * matches the course/module-scope filter (#1187) so an unpublished lesson
 * (or a lesson in an unpublished module) isn't given a nonzero denominator
 * here while contributing nothing at course/module scope.
 */
export async function calculateLessonProgress(lessonId, userId) {
  if (!lessonId || !userId) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  try {
    // Find all activity IDs in this lesson
    const activities = await prisma.activity.findMany({
      where: {
        lessonId,
        lesson: PUBLISHED_LESSON_WHERE,
      },
      select: { id: true },
    });

    const activityIds = activities.map((a) => a.id);
    const totalActivities = activityIds.length;

    if (totalActivities === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    // Get completion count
    const completedCount = await countCompletedActivities(activityIds, userId);

    return {
      completed: completedCount,
      total: totalActivities,
      percentage: Math.round((completedCount / totalActivities) * 100),
    };
  } catch (error) {
    console.error('Error calculating lesson progress:', error);
    return { completed: 0, total: 0, percentage: 0 };
  }
}

/**
 * Get completion status for each activity
 * Returns map of activityId => 'correct' | 'incorrect' | 'not_attempted'
 *
 * Completion is sticky (#1187): an activity is 'correct' if ANY submission
 * was ever correct, even if a later attempt was wrong. This matches
 * countCompletedActivities's counterpart below and the platform's mental
 * model of progress as monotonically non-decreasing.
 */
export async function getActivityCompletionStatuses(activityIds, userId) {
  if (!activityIds || activityIds.length === 0 || !userId) {
    return new Map();
  }

  try {
    const submissions = await prisma.submission.findMany({
      where: {
        userId,
        activityId: { in: activityIds },
      },
      select: {
        activityId: true,
        isCorrect: true,
      },
    });

    const everCorrect = new Set();
    const everAttempted = new Set();
    for (const sub of submissions) {
      everAttempted.add(sub.activityId);
      if (sub.isCorrect === true) everCorrect.add(sub.activityId);
    }

    const statusMap = new Map();
    for (const activityId of activityIds) {
      if (everCorrect.has(activityId)) {
        statusMap.set(activityId, 'correct');
      } else if (everAttempted.has(activityId)) {
        statusMap.set(activityId, 'incorrect');
      } else {
        statusMap.set(activityId, 'not_attempted');
      }
    }

    return statusMap;
  } catch (error) {
    console.error('Error getting activity completion statuses:', error);
    return new Map();
  }
}

/**
 * Helper: Count how many activities have ever had a correct submission.
 * Sticky (#1187): a later incorrect re-attempt does not undo completion.
 * @private
 */
async function countCompletedActivities(activityIds, userId) {
  if (!activityIds || activityIds.length === 0) {
    return 0;
  }

  try {
    const completedActivities = await prisma.submission.findMany({
      where: {
        userId,
        activityId: { in: activityIds },
        isCorrect: true,
      },
      select: { activityId: true },
      distinct: ['activityId'],
    });

    return completedActivities.length;
  } catch (error) {
    console.error('Error counting completed activities:', error);
    return 0;
  }
}
