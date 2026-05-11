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
 * Only counts activities in published lessons
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
 * Counts all activities (no published filter at activity level)
 */
export async function calculateLessonProgress(lessonId, userId) {
  if (!lessonId || !userId) {
    return { completed: 0, total: 0, percentage: 0 };
  }

  try {
    // Find all activity IDs in this lesson
    const activities = await prisma.activity.findMany({
      where: { lessonId },
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
 */
export async function getActivityCompletionStatuses(activityIds, userId) {
  if (!activityIds || activityIds.length === 0 || !userId) {
    return new Map();
  }

  try {
    // Fetch all submissions for these activities by this user
    // Order by attemptNumber descending to get latest first
    const submissions = await prisma.submission.findMany({
      where: {
        userId,
        activityId: { in: activityIds },
      },
      orderBy: [{ activityId: 'asc' }, { attemptNumber: 'desc' }],
      select: {
        activityId: true,
        isCorrect: true,
        attemptNumber: true,
      },
    });

    // Group by activityId and take first (latest due to ordering)
    const latestByActivity = new Map();
    for (const sub of submissions) {
      if (!latestByActivity.has(sub.activityId)) {
        latestByActivity.set(sub.activityId, sub);
      }
    }

    // Build status map
    const statusMap = new Map();
    for (const activityId of activityIds) {
      const latestSubmission = latestByActivity.get(activityId);
      if (!latestSubmission) {
        statusMap.set(activityId, 'not_attempted');
      } else if (latestSubmission.isCorrect === true) {
        statusMap.set(activityId, 'correct');
      } else {
        statusMap.set(activityId, 'incorrect');
      }
    }

    return statusMap;
  } catch (error) {
    console.error('Error getting activity completion statuses:', error);
    return new Map();
  }
}

/**
 * Helper: Count how many activities have correct latest submissions
 * @private
 */
async function countCompletedActivities(activityIds, userId) {
  if (!activityIds || activityIds.length === 0) {
    return 0;
  }

  try {
    // Fetch all submissions for these activities by this user
    const submissions = await prisma.submission.findMany({
      where: {
        userId,
        activityId: { in: activityIds },
      },
      orderBy: [{ activityId: 'asc' }, { attemptNumber: 'desc' }],
      select: {
        activityId: true,
        isCorrect: true,
      },
    });

    // Group by activityId and take first (latest due to ordering)
    const latestByActivity = new Map();
    for (const sub of submissions) {
      if (!latestByActivity.has(sub.activityId)) {
        latestByActivity.set(sub.activityId, sub);
      }
    }

    // Count correct ones
    const completedCount = Array.from(latestByActivity.values()).filter(
      (sub) => sub.isCorrect === true,
    ).length;

    return completedCount;
  } catch (error) {
    console.error('Error counting completed activities:', error);
    return 0;
  }
}
