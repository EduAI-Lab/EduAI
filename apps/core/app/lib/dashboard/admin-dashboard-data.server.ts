/**
 * @file Server-side data for the ADMIN dashboard: platform counts, the "Needs
 * your attention" list, system health (cron jobs + AI services), weekly chat
 * usage, a few courses and the latest audit entries. Everything is read in one
 * parallel batch from the route loader so the page paints with data on first
 * byte, like the other roles' dashboards (#1220).
 */
import prisma from "~/lib/prisma.server";
import { listCoursesForUser } from "~/lib/courses/server";
import { listCronJobStatuses, type CronJobEntry } from "~/lib/db.cron-jobs.server";
import { classifyCloudStatus, type ServiceState } from "~/lib/ai/service-status.server";
import { getUbcStatusCached } from "~/lib/ai/status/read.server";
import type { User } from "~/lib/auth/types";
import type { UserRoleBreakdown } from "~/types/dashboard";
import type {
  AdminActivityEntry,
  AdminAttentionItem,
  AdminDashboardData,
  AdminHealthItem,
  AdminHealthStatus,
  AdminWeeklyChats,
} from "~/types/admin-dashboard";

/** The courses card shows four. */
const ADMIN_COURSE_LIMIT = 4;
const RECENT_ACTIVITY_LIMIT = 5;
/** About six months of weekly buckets, including the current week. */
export const USAGE_WEEKS = 26;

/** Always listed in System health; any other job appears only when its last run failed. */
const KEY_CRON_JOBS = ["ai-status-probe", "backup-nightly", "notify-invitation-expiry"];

const CRON_JOB_NAMES = new Map([
  ["ai-status-probe", "AI status probe"],
  ["backup-nightly", "Nightly backup"],
  ["notify-invitation-expiry", "Invitation expiry"],
]);

/** "backup-offsite" → "Backup offsite", keeping acronyms upper-case. */
export function cronJobDisplayName(name: string): string {
  const known = CRON_JOB_NAMES.get(name);
  if (known) return known;
  const words = name
    .split("-")
    .map((w) => (["ai", "qm", "api"].includes(w) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function daysAgoPhrase(date: Date, now: Date): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Monday 00:00 UTC of the week containing `date` — Postgres `date_trunc('week')`. */
export function startOfUtcWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

/** Fill every week in the window, so a week with no chats plots as 0 instead of being skipped. */
export function fillWeeklyChats(
  rows: { week: Date; count: number }[],
  now: Date,
  weeks = USAGE_WEEKS,
): AdminWeeklyChats[] {
  const byWeek = new Map(rows.map((r) => [startOfUtcWeek(r.week).getTime(), Number(r.count)]));
  const current = startOfUtcWeek(now);
  const out: AdminWeeklyChats[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(current);
    week.setUTCDate(week.getUTCDate() - i * 7);
    out.push({
      weekStart: week.toISOString().slice(0, 10),
      count: byWeek.get(week.getTime()) ?? 0,
    });
  }
  return out;
}

async function usersByRole(): Promise<{ total: number; byRole: UserRoleBreakdown }> {
  const rows = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  const byRole: UserRoleBreakdown = { students: 0, instructors: 0, admins: 0, other: 0 };
  let total = 0;
  for (const r of rows) {
    const n = r._count._all;
    total += n;
    if (r.role === "STUDENT") byRole.students += n;
    else if (r.role === "INSTRUCTOR") byRole.instructors += n;
    else if (r.role === "ADMIN") byRole.admins += n;
    else byRole.other += n;
  }
  return { total, byRole };
}

function healthFromServiceState(state: ServiceState): AdminHealthStatus {
  if (state === "operational") return "ok";
  if (state === "degraded") return "degraded";
  if (state === "outage") return "failed";
  return "not-set";
}

/** Key jobs plus every other job whose latest run failed. */
export function cronHealthItems(jobs: CronJobEntry[]): AdminHealthItem[] {
  return jobs
    .filter((job) => KEY_CRON_JOBS.includes(job.name) || job.lastRun?.status === "ERROR")
    .map((job) => {
      const run = job.lastRun;
      const status: AdminHealthStatus = !run ? "not-set" : run.status === "ERROR" ? "failed" : "ok";
      return {
        id: `cron:${job.name}`,
        kind: "cron",
        name: cronJobDisplayName(job.name),
        status,
        detail: run ? (run.status === "RUNNING" ? "Running now" : null) : "Never run",
        lastRunAt: run ? (run.finishedAt ?? run.startedAt) : null,
      };
    });
}

async function aiHealthItems(): Promise<AdminHealthItem[]> {
  const cloud = classifyCloudStatus({
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  });
  const ubc = await getUbcStatusCached();
  return [
    {
      id: "ai:ubc",
      kind: "ai",
      name: "UBC models",
      status: healthFromServiceState(ubc.status.state),
      detail: ubc.status.detail,
      lastRunAt: ubc.checkedAt,
    },
    {
      id: "ai:cloud",
      kind: "ai",
      name: "Cloud API",
      // Cloud status is key presence only; no key means it is not set up, not down.
      status: cloud.state === "operational" ? "ok" : "not-set",
      detail: cloud.state === "operational" ? cloud.detail : "No provider key set",
      lastRunAt: null,
    },
  ];
}

async function weeklyChats(now: Date): Promise<AdminWeeklyChats[]> {
  const since = startOfUtcWeek(now);
  since.setUTCDate(since.getUTCDate() - (USAGE_WEEKS - 1) * 7);
  const rows = await prisma.$queryRaw<{ week: Date; count: number }[]>`
    SELECT date_trunc('week', "createdAt") AS week, COUNT(*)::int AS count
    FROM chats
    WHERE "createdAt" >= ${since}
    GROUP BY 1
  `;
  return fillWeeklyChats(rows, now);
}

async function recentActivity(): Promise<AdminActivityEntry[]> {
  // Successful changes only: denied/failed attempts (rate limits, access
  // denials) belong in the full log, not a "what changed" summary.
  const rows = await prisma.auditLog.findMany({
    where: { outcome: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    take: RECENT_ACTIVITY_LIMIT,
    select: {
      id: true,
      actionCode: true,
      entityLabel: true,
      actorType: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    actionCode: r.actionCode,
    entityLabel: r.entityLabel,
    actorName: r.user?.name ?? (r.actorType === "USER" ? null : "System"),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function loadAdminDashboardData(user: User): Promise<AdminDashboardData> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const liveCourse = { deletedAt: null };

  const [
    users,
    courseTotal,
    publishedCourses,
    materialTotal,
    readyMaterials,
    failedMaterials,
    chatTotal,
    chatWeek,
    unitAdminsWithoutUnits,
    unhandledBugReports,
    pendingInvitations,
    oldestInvitation,
    neverSignedIn,
    coursesWithoutInstructor,
    cronJobs,
    aiHealth,
    weekly,
    coursePage,
    activity,
  ] = await Promise.all([
    usersByRole(),
    prisma.course.count({ where: liveCourse }),
    prisma.course.count({ where: { ...liveCourse, isPublished: true } }),
    prisma.courseMaterial.count({ where: { deletedAt: null } }),
    prisma.courseMaterial.count({ where: { deletedAt: null, status: "READY" } }),
    prisma.courseMaterial.count({ where: { deletedAt: null, status: "FAILED" } }),
    prisma.chat.count(),
    prisma.chat.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({
      where: { role: "UNIT_ADMIN", isActive: true, authorizedUnits: { isEmpty: true } },
    }),
    prisma.bugReport.count({ where: { status: "UNHANDLED" } }),
    prisma.invitation.count({ where: { status: "PENDING", expiresAt: { gt: now } } }),
    prisma.invitation.findFirst({
      where: { status: "PENDING", expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.user.count({ where: { isActive: true, lastSignInAt: null } }),
    prisma.course.count({
      where: {
        ...liveCourse,
        isActive: true,
        enrollments: { none: { role: "INSTRUCTOR", isActive: true } },
      },
    }),
    listCronJobStatuses(),
    aiHealthItems(),
    weeklyChats(now),
    listCoursesForUser(
      { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits ?? undefined },
      { pageSize: ADMIN_COURSE_LIMIT },
    ),
    recentActivity(),
  ]);

  const failedJobs = cronJobs.filter((job) => job.lastRun?.status === "ERROR");

  const attention: AdminAttentionItem[] = [
    {
      id: "unit-admins-without-units",
      title: "Unit Admins with no units",
      description:
        unitAdminsWithoutUnits > 0
          ? "They cannot view or create courses."
          : "Every Unit Admin has a unit.",
      count: unitAdminsWithoutUnits,
      severity: "destructive",
      href: "/admin/users",
    },
    {
      id: "failed-materials",
      title: "Failed materials",
      description:
        failedMaterials > 0
          ? `${plural(failedMaterials, "material", "materials")} could not be processed.`
          : "No materials failed to process.",
      count: failedMaterials,
      severity: "destructive",
      href: "/courses",
    },
    {
      id: "failed-cron-jobs",
      title: "Failed scheduled jobs",
      description:
        failedJobs.length > 0
          ? `${failedJobs.map((job) => cronJobDisplayName(job.name)).join(", ")} ${failedJobs.length === 1 ? "needs" : "need"} attention.`
          : "Every scheduled job's last run succeeded.",
      count: failedJobs.length,
      severity: "destructive",
      href: "/admin/cron-jobs",
    },
    {
      id: "unhandled-bug-reports",
      title: "Unhandled bug reports",
      description:
        unhandledBugReports > 0
          ? `${plural(unhandledBugReports, "report needs", "reports need")} triage.`
          : "Every report has been triaged.",
      count: unhandledBugReports,
      severity: "warning",
      href: "/admin/bug-reports",
    },
    {
      id: "pending-invitations",
      title: "Pending invitations",
      description: oldestInvitation
        ? `Oldest invitation sent ${daysAgoPhrase(oldestInvitation.createdAt, now)}.`
        : "No invitations are waiting.",
      count: pendingInvitations,
      severity: "warning",
      href: "/admin/invitations",
    },
    {
      id: "never-signed-in",
      title: "Accounts that never signed in",
      description:
        neverSignedIn > 0
          ? `${plural(neverSignedIn, "account has", "accounts have")} not signed in yet.`
          : "Every active account has signed in.",
      count: neverSignedIn,
      severity: "warning",
      href: "/admin/users",
    },
    {
      id: "courses-without-instructor",
      title: "Courses with no instructor",
      description:
        coursesWithoutInstructor > 0
          ? `${plural(coursesWithoutInstructor, "active course has", "active courses have")} no instructor.`
          : "Every active course has an instructor.",
      count: coursesWithoutInstructor,
      severity: "warning",
      href: "/courses",
    },
  ];

  return {
    users,
    courses: { total: courseTotal, published: publishedCourses },
    materials: { total: materialTotal, ready: readyMaterials },
    aiSessions: { total: chatTotal, thisWeek: chatWeek },
    attention,
    health: [...cronHealthItems(cronJobs), ...aiHealth],
    weeklyChats: weekly,
    courseList: coursePage.courses.map((course) => ({
      id: course.id,
      code: course.code,
      name: course.name,
      term: course.term,
      year: course.year,
      isPublished: course.isPublished,
      callerEnrollmentRole: course.callerEnrollmentRole ?? null,
    })),
    recentActivity: activity,
  };
}
