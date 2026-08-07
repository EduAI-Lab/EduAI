/**
 * @file Aggregate per-student activity metrics into instructor-facing analytics.
 *
 * Responsibility: Record help/submission/feedback events and recompute the
 * denormalized `ActivityAnalytics` row that powers instructor difficulty and
 * engagement views.
 * Callers: Activity answer/feedback routes and any future workflow that needs
 * to persist student-level tutoring or submission signals.
 * Gotchas:
 *   - Difficulty is a hand-tuned policy heuristic, not a statistically-derived
 *     model: `helpPerStudent * 15 + incorrectRate * 45 + ratingPenalty * 25`.
 *     Treat the coefficients and 35/65 thresholds as product decisions that
 *     should be changed deliberately.
 *   - Analytics are recomputed from raw `ActivityStudentMetric` and
 *     `ActivityFeedback` rows inside the same transaction that records the new
 *     event, so the aggregate row is always derived from canonical source data.
 *   - `studentCount` is floored to 1 for scoring math so a brand-new activity
 *     with help requests cannot divide by zero.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/activities.js`,
 *   `server/prisma/schema.prisma`.
 */

import { prisma } from '../config/database.js';

/**
 * Convert raw engagement signals into the coarse difficulty label shown to instructors.
 *
 * @returns Difficulty score on a 0-100 scale plus the LOW/MEDIUM/HIGH band.
 *
 * Why: The platform cares more about actionable triage than perfect rigor, so
 * the heuristic weights incorrect answers most heavily, then AI-help demand,
 * then student sentiment to surface activities that likely need revision.
 */
export function calculateDifficulty({
  studentCount,
  helpRequestCount,
  submissionCount,
  incorrectSubmissionCount,
  averageRating,
}) {
  const normalizedStudentCount = Math.max(studentCount || 0, 1);
  const helpPerStudent = helpRequestCount / normalizedStudentCount;
  const incorrectRate = submissionCount > 0 ? incorrectSubmissionCount / submissionCount : 0;
  const ratingPenalty = typeof averageRating === 'number' ? (5 - averageRating) / 4 : 0;

  // These coefficients are a product-policy dial: incorrect answers dominate,
  // help-seeking is a secondary signal, and ratings only nudge the result.
  const difficultyScore = Math.max(
    0,
    Math.min(100, Math.round(helpPerStudent * 15 + incorrectRate * 45 + ratingPenalty * 25)),
  );

  const difficultyLabel = difficultyScore >= 65 ? 'HIGH' : difficultyScore >= 35 ? 'MEDIUM' : 'LOW';

  return { difficultyScore, difficultyLabel };
}

async function recalculateActivityAnalytics(tx, activityId) {
  const [studentMetrics, feedbackRecords] = await Promise.all([
    tx.activityStudentMetric.findMany({
      where: { activityId },
      select: {
        helpRequestCount: true,
        submissionCount: true,
        incorrectSubmissionCount: true,
        correctSubmissionCount: true,
      },
    }),
    tx.activityFeedback.findMany({
      where: { activityId },
      select: { rating: true },
    }),
  ]);

  const aggregates = studentMetrics.reduce(
    (acc, metric) => {
      acc.helpRequestCount += metric.helpRequestCount;
      acc.submissionCount += metric.submissionCount;
      acc.incorrectSubmissionCount += metric.incorrectSubmissionCount;
      acc.correctSubmissionCount += metric.correctSubmissionCount;
      return acc;
    },
    {
      helpRequestCount: 0,
      submissionCount: 0,
      incorrectSubmissionCount: 0,
      correctSubmissionCount: 0,
    },
  );

  const feedbackCount = feedbackRecords.length;
  const averageRating =
    feedbackCount > 0
      ? feedbackRecords.reduce((sum, feedback) => sum + feedback.rating, 0) / feedbackCount
      : null;

  const { difficultyScore, difficultyLabel } = calculateDifficulty({
    studentCount: studentMetrics.length,
    helpRequestCount: aggregates.helpRequestCount,
    submissionCount: aggregates.submissionCount,
    incorrectSubmissionCount: aggregates.incorrectSubmissionCount,
    averageRating,
  });

  return tx.activityAnalytics.upsert({
    where: { activityId },
    update: {
      ...aggregates,
      studentCount: studentMetrics.length,
      feedbackCount,
      averageRating,
      difficultyScore,
      difficultyLabel,
    },
    create: {
      activityId,
      ...aggregates,
      studentCount: studentMetrics.length,
      feedbackCount,
      averageRating,
      difficultyScore,
      difficultyLabel,
    },
  });
}

/**
 * Record that a student asked the tutor for help on an activity.
 *
 * Why: Help requests are one of the few signals that capture "students are
 * stuck before submitting", so we fold them into the aggregate immediately.
 */
export async function recordAiHelpRequest({ userId, activityId }) {
  return prisma.$transaction(async (tx) => {
    await tx.activityStudentMetric.upsert({
      where: {
        userId_activityId: {
          userId,
          activityId,
        },
      },
      update: {
        helpRequestCount: {
          increment: 1,
        },
      },
      create: {
        userId,
        activityId,
        helpRequestCount: 1,
      },
    });

    return recalculateActivityAnalytics(tx, activityId);
  });
}

/**
 * Record a student submission outcome and refresh the aggregate analytics row.
 *
 * Why: Submission counts and correctness drive the strongest difficulty signal,
 * so this write path recomputes analytics synchronously instead of leaving the
 * aggregate stale until a background job runs.
 */
export async function recordSubmissionMetrics({ userId, activityId, isCorrect }) {
  return prisma.$transaction(async (tx) => {
    await tx.activityStudentMetric.upsert({
      where: {
        userId_activityId: {
          userId,
          activityId,
        },
      },
      update: {
        submissionCount: {
          increment: 1,
        },
        incorrectSubmissionCount: {
          increment: isCorrect ? 0 : 1,
        },
        correctSubmissionCount: {
          increment: isCorrect ? 1 : 0,
        },
      },
      create: {
        userId,
        activityId,
        submissionCount: 1,
        incorrectSubmissionCount: isCorrect ? 0 : 1,
        correctSubmissionCount: isCorrect ? 1 : 0,
      },
    });

    return recalculateActivityAnalytics(tx, activityId);
  });
}

/**
 * Persist a student's post-activity rating/note and refresh aggregate analytics.
 *
 * Why: Feedback volume and average rating provide the only direct sentiment
 * signal, so they are stored separately from submission metrics but rolled into
 * the same aggregate row for instructor review.
 */
export async function recordActivityFeedback({ userId, activityId, submissionId, rating, note }) {
  return prisma.$transaction(async (tx) => {
    const feedback = await tx.activityFeedback.create({
      data: {
        userId,
        activityId,
        submissionId,
        rating,
        note: note || null,
      },
    });

    await recalculateActivityAnalytics(tx, activityId);
    return feedback;
  });
}

/**
 * Check whether the student has already left feedback for this activity.
 *
 * Why: Feedback is modeled as one row per `(userId, activityId)`, and the UI
 * needs a cheap guard before showing a duplicate-rating flow.
 */
export async function hasActivityFeedback({ userId, activityId }) {
  const existing = await prisma.activityFeedback.findUnique({
    where: {
      userId_activityId: {
        userId,
        activityId,
      },
    },
    select: { id: true },
  });

  return Boolean(existing);
}
