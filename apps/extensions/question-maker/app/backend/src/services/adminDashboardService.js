/**
 * @file The ADMIN dashboard's Question Maker rollup: content totals, courses and
 *   assessments, the "Needs your attention" counts, AI health and weekly
 *   question versions. Counts come from QM's own tables; open bug reports, AI
 *   service status and the model catalog come from Core with the admin's own
 *   session cookie, the same way the bug-report and AI-status proxies call it.
 *   A Core call that fails drops or marks only its own row, never the page.
 */

import { prisma } from "../config/database.js";
import { config } from "../config/settings.js";
import { eduaiService } from "./eduaiService.js";
import { isCampusModel, pickPreferredGenerationFromCatalog } from "./modelCatalog.js";

/** Weeks of question versions the usage chart covers (about six months). */
export const USAGE_WEEKS = 26;

/** AI drafts older than this are flagged as waiting for review. */
export const STALE_DRAFT_DAYS = 14;

/** Canvas banks not synced for this long are flagged. */
export const STALE_SYNC_DAYS = 30;

/** Entries in the Recent activity card. */
export const RECENT_ACTIVITY_LIMIT = 6;

const DAY_MS = 86_400_000;
const CORE_TIMEOUT_MS = 5000;

const ASSESSMENT_TYPES = ["Quiz", "Assignment", "Lab", "Midterm", "Final"];

/** Monday 00:00 UTC of the week holding `date`, like Postgres `date_trunc('week')`. */
export function startOfUtcWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day;
}

/**
 * Every week in the window, oldest first, split into AI-generated and
 * hand-written versions, with 0 for weeks that had none.
 */
export function fillWeeklyVersions(rows, now = new Date()) {
  const counts = new Map();
  for (const row of rows) {
    const key = startOfUtcWeek(new Date(row.week)).toISOString().slice(0, 10);
    const entry = counts.get(key) ?? { ai: 0, manual: 0 };
    if (row.isAiGenerated) entry.ai += Number(row.count);
    else entry.manual += Number(row.count);
    counts.set(key, entry);
  }
  const thisWeek = startOfUtcWeek(now);
  const weeks = [];
  for (let back = USAGE_WEEKS - 1; back >= 0; back -= 1) {
    const key = new Date(thisWeek.getTime() - back * 7 * DAY_MS).toISOString().slice(0, 10);
    const entry = counts.get(key) ?? { ai: 0, manual: 0 };
    weeks.push({ weekStart: key, ai: entry.ai, manual: entry.manual });
  }
  return weeks;
}

const SERVICE_STATE_TO_HEALTH = {
  operational: "ok",
  degraded: "degraded",
  outage: "failed",
  unknown: "not-set",
};

/** Two rows from Core's shared AI-status snapshot (the header chips' source). */
export function aiServiceHealthItems(aiStatus) {
  const row = (id, name, service) => {
    if (!service || typeof service.state !== "string") {
      return { id, name, status: "failed", detail: "Couldn't read the status from Core" };
    }
    return {
      id,
      name,
      status: SERVICE_STATE_TO_HEALTH[service.state] ?? "not-set",
      detail: service.detail || service.state,
    };
  };
  const ok = aiStatus?.status === 200;
  return [
    row("ubc-ai", "UBC-hosted AI", ok ? aiStatus.body?.ubc : null),
    row("cloud-ai", "Cloud AI", ok ? aiStatus.body?.cloud : null),
  ];
}

/**
 * The service key, Core's model catalog, and the model generation will use.
 * QM has no admin-chosen model: it takes the largest campus model in the
 * catalog (see `modelCatalog.js`), so that is what the row reports.
 */
export function connectionHealthItems({ hasApiKey, models, modelsError }) {
  const keyRow = hasApiKey
    ? { id: "eduai-api-key", name: "EduAI API key", status: "ok", detail: "Set" }
    : { id: "eduai-api-key", name: "EduAI API key", status: "not-set", detail: "No key set" };

  if (modelsError) {
    return [
      keyRow,
      { id: "model-catalog", name: "Model catalog (Core)", status: "failed", detail: modelsError },
      {
        id: "generation-model",
        name: "Generation model",
        status: "failed",
        detail: "The model catalog couldn't be read",
      },
    ];
  }

  const active = models.filter((model) => model && model.isActive !== false);
  const picked = pickPreferredGenerationFromCatalog(models);
  return [
    keyRow,
    {
      id: "model-catalog",
      name: "Model catalog (Core)",
      status: active.length > 0 ? "ok" : "failed",
      detail: `${active.length} ${active.length === 1 ? "model" : "models"} available`,
    },
    picked
      ? {
          id: "generation-model",
          name: "Generation model",
          status: "ok",
          detail: `${picked.label}${isCampusModel(picked) ? "" : " (cloud)"}`,
        }
      : {
          id: "generation-model",
          name: "Generation model",
          status: "failed",
          detail: "No active model in the catalog",
        },
  ];
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function attentionItem(id, title, count, severity, href, describe) {
  return { id, title, count, severity, href, description: describe(count) };
}

/** Unhandled Question Maker reports in Core, or `null` if Core couldn't be asked. */
async function countOpenBugReports(cookie) {
  try {
    const url = new URL(`${config.coreUrl}/api/admin/bug-reports`);
    url.searchParams.set("source", "QUESTION_MAKER");
    url.searchParams.set("status", "UNHANDLED");
    url.searchParams.set("limit", "1");
    const response = await fetch(url.toString(), {
      headers: { cookie },
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return typeof body?.total === "number" ? body.total : null;
  } catch {
    return null;
  }
}

async function loadModels(cookie) {
  try {
    return { models: await eduaiService.listAIModels({ cookie }), modelsError: null };
  } catch (error) {
    return { models: [], modelsError: error?.message || "Couldn't reach Core" };
  }
}

function recentActivity(questions, assessments) {
  const items = [
    ...questions.map((q) => ({
      id: `question-${q.id}`,
      kind: "question",
      label: q.description?.trim() || `${q.type} question`,
      href: `/courses/${q.courseId}?tab=questions`,
      by: q.creator?.name ?? null,
      updatedAt: q.updatedAt.toISOString(),
    })),
    ...assessments.map((a) => ({
      id: `assessment-${a.id}`,
      kind: "assessment",
      label: a.name,
      href: a.courseId === null ? "/courses" : `/courses/${a.courseId}/assessments/${a.id}`,
      by: null,
      updatedAt: a.updatedAt.toISOString(),
    })),
  ];
  return items
    .toSorted((x, y) => y.updatedAt.localeCompare(x.updatedAt))
    .slice(0, RECENT_ACTIVITY_LIMIT);
}

/**
 * @param {{ cookie?: string, now?: Date }} options `cookie` is the admin's
 *   session, forwarded to Core for the bug-report, status and model reads.
 */
export async function loadAdminDashboard({ cookie = "", now = new Date() } = {}) {
  const staleDraftBefore = new Date(now.getTime() - STALE_DRAFT_DAYS * DAY_MS);
  const staleSyncBefore = new Date(now.getTime() - STALE_SYNC_DAYS * DAY_MS);
  const windowStart = new Date(startOfUtcWeek(now).getTime() - (USAGE_WEEKS - 1) * 7 * DAY_MS);

  const [
    questionTotal,
    versionTotal,
    draftVersions,
    aiVersions,
    sharedVersions,
    courseTotal,
    coursesWithQuestions,
    canvasLinkedCourses,
    assessmentsByType,
    staleAiDrafts,
    questionsWithoutVersions,
    emptyAssessments,
    staleCanvasBanks,
    weekly,
    recentQuestions,
    recentAssessments,
    openBugReports,
    aiStatus,
    catalog,
  ] = await Promise.all([
    prisma.questionMetadata.count(),
    prisma.variants.count(),
    prisma.variants.count({ where: { isDraft: true } }),
    prisma.variants.count({ where: { isAiGenerated: true } }),
    prisma.variants.count({ where: { shareWithExtensions: true } }),
    prisma.course.count(),
    prisma.course.count({ where: { questionMetadata: { some: {} } } }),
    prisma.canvasCourseMapping.count(),
    prisma.assessments.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.variants.count({
      where: { isAiGenerated: true, isDraft: true, createdAt: { lt: staleDraftBefore } },
    }),
    prisma.questionMetadata.count({ where: { variants: { none: {} } } }),
    prisma.assessments.count({
      where: {
        variants: { none: {} },
        sections: { none: { sectionVariants: { some: {} } } },
      },
    }),
    prisma.canvasBankMapping.count({
      where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleSyncBefore } }] },
    }),
    prisma.$queryRaw`
      SELECT date_trunc('week', "created_at") AS "week",
             "is_ai_generated" AS "isAiGenerated",
             COUNT(*)::int AS "count"
      FROM "variants"
      WHERE "created_at" >= ${windowStart}
      GROUP BY 1, 2
    `,
    prisma.questionMetadata.findMany({
      orderBy: { updatedAt: "desc" },
      take: RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        description: true,
        type: true,
        courseId: true,
        updatedAt: true,
        creator: { select: { name: true } },
      },
    }),
    prisma.assessments.findMany({
      orderBy: { updatedAt: "desc" },
      take: RECENT_ACTIVITY_LIMIT,
      select: { id: true, name: true, courseId: true, updatedAt: true },
    }),
    countOpenBugReports(cookie),
    eduaiService.getAiStatus({ cookie }),
    loadModels(cookie),
  ]);

  const typeCounts = new Map(assessmentsByType.map((row) => [row.type, row._count._all]));
  const assessmentTypes = ASSESSMENT_TYPES.map((type) => ({
    type,
    count: typeCounts.get(type) ?? 0,
  }));

  const attention = [
    ...(openBugReports === null
      ? []
      : [
          attentionItem(
            "open-bug-reports",
            "Unhandled bug reports",
            openBugReports,
            "destructive",
            "/admin/bug-reports",
            (n) =>
              n > 0
                ? `${plural(n, "report needs", "reports need")} triage.`
                : "No reports waiting for triage.",
          ),
        ]),
    attentionItem(
      "stale-ai-drafts",
      "AI drafts waiting for review",
      staleAiDrafts,
      "warning",
      "/library",
      (n) =>
        n > 0
          ? `${plural(n, "AI draft has", "AI drafts have")} not been reviewed in ${STALE_DRAFT_DAYS} days.`
          : `No AI draft is older than ${STALE_DRAFT_DAYS} days.`,
    ),
    attentionItem(
      "questions-without-versions",
      "Questions with no versions",
      questionsWithoutVersions,
      "warning",
      "/library",
      (n) =>
        n > 0
          ? `${plural(n, "question has", "questions have")} nothing to put in an assessment.`
          : "Every question has at least one version.",
    ),
    attentionItem(
      "empty-assessments",
      "Assessments with no questions",
      emptyAssessments,
      "warning",
      "/courses",
      (n) =>
        n > 0
          ? `${plural(n, "assessment is", "assessments are")} still empty.`
          : "Every assessment has questions.",
    ),
    attentionItem(
      "stale-canvas-banks",
      "Canvas banks out of sync",
      staleCanvasBanks,
      "warning",
      "/courses",
      (n) =>
        n > 0
          ? `${plural(n, "bank was", "banks were")} never synced or not synced in ${STALE_SYNC_DAYS} days.`
          : `Every Canvas bank synced in the last ${STALE_SYNC_DAYS} days.`,
    ),
  ];

  return {
    content: {
      questions: questionTotal,
      versions: versionTotal,
      drafts: draftVersions,
      reviewed: versionTotal - draftVersions,
      aiGenerated: aiVersions,
      shared: sharedVersions,
    },
    courses: {
      total: courseTotal,
      withQuestions: coursesWithQuestions,
      canvasLinked: canvasLinkedCourses,
    },
    assessments: {
      total: assessmentTypes.reduce((sum, row) => sum + row.count, 0),
      byType: assessmentTypes,
    },
    attention,
    health: [
      ...aiServiceHealthItems(aiStatus),
      ...connectionHealthItems({ hasApiKey: eduaiService.hasApiKey(), ...catalog }),
    ],
    weeklyVersions: fillWeeklyVersions(weekly, now),
    recentActivity: recentActivity(recentQuestions, recentAssessments),
  };
}
