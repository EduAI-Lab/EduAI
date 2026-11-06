/**
 * @file The ADMIN dashboard's AI Tutor rollup: content and tutoring totals,
 *   the "Needs your attention" counts, AI tutor health, and weekly tutoring
 *   sessions. Everything here is a local AI Tutor table or the AI settings the
 *   admin console already reads; course and bug-report counts stay on
 *   `GET /me/dashboard-stats`, which already resolves them against Core.
 */

import { prisma } from "../config/database.js";
import { getAiModelPolicyState } from "./aiModelPolicy.js";
import { getEduAiApiKeyStatus } from "./systemSettings.js";

/** Weeks of tutoring sessions the usage chart covers (about six months). */
export const USAGE_WEEKS = 26;

/** Window for "this week" counts and for tutor replies that went wrong. */
const RECENT_DAYS = 7;

/** A reply the tutor could not give normally (see `aiGuidance.js` outcomes). */
export const FAILED_REPLY_OUTCOMES = ["error", "error_timeout", "safe_fallback"];

/** Activities rated below this average (with at least one rating) need a look. */
export const LOW_RATING_THRESHOLD = 2.5;

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the week holding `date`, like Postgres `date_trunc('week')`. */
export function startOfUtcWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day;
}

/** Every week in the window, oldest first, with 0 for weeks that had no sessions. */
export function fillWeeklySessions(rows, now = new Date()) {
  const counts = new Map(
    rows.map((row) => [startOfUtcWeek(new Date(row.week)).toISOString().slice(0, 10), row.count]),
  );
  const thisWeek = startOfUtcWeek(now);
  const weeks = [];
  for (let back = USAGE_WEEKS - 1; back >= 0; back -= 1) {
    const week = new Date(thisWeek.getTime() - back * 7 * DAY_MS);
    const key = week.toISOString().slice(0, 10);
    weeks.push({ weekStart: key, count: counts.get(key) ?? 0 });
  }
  return weeks;
}

/**
 * One health row per AI dependency, from the same reads the admin console's
 * AI settings tab makes. Status is "ok", "failed" or "not-set".
 */
export function aiHealthItems(apiKeyStatus, modelPolicyState) {
  const { policy, availableModels, availableModelsError } = modelPolicyState;
  const available = new Set(availableModels.map((model) => model.modelId));
  const catalogOk = !availableModelsError;

  const modelRow = (id, name, modelId) => {
    if (!modelId) return { id, name, status: "not-set", detail: "No model chosen" };
    if (catalogOk && !available.has(modelId)) {
      return { id, name, status: "failed", detail: `${modelId} is not in the model catalog` };
    }
    return { id, name, status: "ok", detail: modelId };
  };

  return [
    apiKeyStatus.configured
      ? {
          id: "eduai-api-key",
          name: "EduAI API key",
          status: "ok",
          detail: apiKeyStatus.source === "ADMIN" ? "Set by an admin" : "From the environment",
        }
      : { id: "eduai-api-key", name: "EduAI API key", status: "not-set", detail: "No key set" },
    catalogOk
      ? {
          id: "model-catalog",
          name: "Model catalog (Core)",
          status: "ok",
          detail: `${availableModels.length} models available`,
        }
      : {
          id: "model-catalog",
          name: "Model catalog (Core)",
          status: "failed",
          detail: availableModelsError,
        },
    modelRow("tutor-model", "Tutor model", policy.defaultTutorModelId),
    policy.dualLoopEnabled === false
      ? { id: "reviewer-model", name: "Reviewer model", status: "not-set", detail: "Review is off" }
      : modelRow("reviewer-model", "Reviewer model", policy.defaultSupervisorModelId),
  ];
}

function attentionItem(id, title, count, severity, href, describe) {
  return { id, title, count, severity, href, description: describe(count) };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export async function loadAdminDashboard(now = new Date()) {
  const weekAgo = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const windowStart = new Date(startOfUtcWeek(now).getTime() - (USAGE_WEEKS - 1) * 7 * DAY_MS);

  const [
    activityTotal,
    sessionTotal,
    sessionsThisWeek,
    learnersThisWeek,
    submissionTotal,
    submissionsToReview,
    ratings,
    failedReplies,
    hardActivities,
    lowRatedActivities,
    coursesWithoutActivities,
    weekly,
    apiKeyStatus,
    modelPolicyState,
  ] = await Promise.all([
    prisma.activity.count(),
    prisma.aiChatSession.count(),
    prisma.aiChatSession.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.aiChatSession.findMany({
      where: { updatedAt: { gte: weekAgo } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.submission.count(),
    prisma.submission.count({ where: { isCorrect: null } }),
    prisma.activityFeedback.aggregate({ _avg: { rating: true }, _count: { _all: true } }),
    prisma.aiInteractionTrace.count({
      where: { finalOutcome: { in: FAILED_REPLY_OUTCOMES }, createdAt: { gte: weekAgo } },
    }),
    prisma.activityAnalytics.count({ where: { difficultyLabel: "HIGH" } }),
    prisma.activityAnalytics.count({
      where: { feedbackCount: { gt: 0 }, averageRating: { lt: LOW_RATING_THRESHOLD } },
    }),
    prisma.courseOffering.count({
      where: { modules: { none: { lessons: { some: { activities: { some: {} } } } } } },
    }),
    prisma.$queryRaw`
      SELECT date_trunc('week', "createdAt") AS "week", COUNT(*)::int AS "count"
      FROM "AiChatSession"
      WHERE "createdAt" >= ${windowStart}
      GROUP BY 1
    `,
    getEduAiApiKeyStatus(),
    getAiModelPolicyState(),
  ]);

  return {
    content: { activities: activityTotal },
    tutoring: {
      sessions: sessionTotal,
      sessionsThisWeek,
      learnersThisWeek: learnersThisWeek.length,
    },
    submissions: { total: submissionTotal, toReview: submissionsToReview },
    ratings: {
      average: ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 10) / 10,
      count: ratings._count._all,
    },
    attention: [
      attentionItem(
        "failed-replies",
        "Tutor replies that failed",
        failedReplies,
        "destructive",
        "/admin?tab=ai-oversight",
        (n) =>
          n > 0
            ? `${plural(n, "reply", "replies")} errored or fell back in the last 7 days.`
            : "No failed replies in the last 7 days.",
      ),
      attentionItem(
        "hard-activities",
        "Activities students find hard",
        hardActivities,
        "warning",
        "/instructor",
        (n) =>
          n > 0
            ? `${plural(n, "activity has", "activities have")} a high difficulty score.`
            : "No activity has a high difficulty score.",
      ),
      attentionItem(
        "low-rated-activities",
        "Low-rated activities",
        lowRatedActivities,
        "warning",
        "/instructor",
        (n) =>
          n > 0
            ? `${plural(n, "activity averages", "activities average")} below ${LOW_RATING_THRESHOLD} stars.`
            : `No activity averages below ${LOW_RATING_THRESHOLD} stars.`,
      ),
      attentionItem(
        "courses-without-activities",
        "Courses with no activities",
        coursesWithoutActivities,
        "warning",
        "/instructor",
        (n) =>
          n > 0
            ? `${plural(n, "course has", "courses have")} nothing for students to do yet.`
            : "Every course has at least one activity.",
      ),
      attentionItem(
        "submissions-to-review",
        "Submissions waiting to be graded",
        submissionsToReview,
        "warning",
        "/instructor",
        (n) =>
          n > 0
            ? `${plural(n, "submission is", "submissions are")} waiting for a grade.`
            : "Nothing is waiting for a grade.",
      ),
    ],
    health: aiHealthItems(apiKeyStatus, modelPolicyState),
    weeklySessions: fillWeeklySessions(weekly, now),
  };
}
