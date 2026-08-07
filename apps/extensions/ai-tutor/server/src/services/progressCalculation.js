import { prisma } from '../config/database.js';

/**
 * Calculate progress for a course based on correct submissions
 * Progress = (# activities with correct latest submission) / (# published activities)
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
          isPublished: true,
          module: {
            isPublished: true,
            courseOfferingId: courseId,
          },
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
        lesson: {
          isPublished: true,
          moduleId,
          module: { isPublished: true },
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
        lesson: { isPublished: true, module: { isPublished: true } },
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
 * calculateDifficulty's counterpart in countCompletedActivities below and
 * the platform's mental model of progress as monotonically non-decreasing.
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
