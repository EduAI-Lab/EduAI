/**
 * @file The ADMIN dashboard, in Core's admin dashboard layout but about AI
 * Tutor only: four rows of paired cards (courses + content & tutoring; needs
 * your attention + AI tutor health; tutoring sessions + courses; recent AI
 * activity + getting started). Every card is the shared `PanelCard` with
 * `Badge`, the dashboard's `CourseListPanel` and the inline
 * `OnboardingChecklist` inside, so styling stays on the design system. Users
 * are managed in Core, so they are not shown here.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { IconBooks, IconChevronRight, IconMessageChatbot, IconSparkles } from "@tabler/icons-react";
import {
  Badge,
  OnboardingChecklist,
  PanelCard,
  type BadgeVariant,
  type OnboardingTask,
} from "@eduai/ui";

import type { AiTraceRow, DashboardStats } from "~/lib/api";
import type { AdminAttentionItem, AdminDashboardData, AdminHealthItem } from "~/lib/api-schemas";
import type { Course } from "~/lib/types";
import { formatLabel, outcomeBadgeVariant } from "~/components/admin/AiOversightPanel";
import { TruncatedListNotice } from "~/components/common/TruncatedListNotice";
import { CourseListPanel } from "./DashboardView";
import { relativeTime, toDashboardCourseRow } from "./dashboard-helpers";

const WeeklyUsageChart = lazy(() => import("@eduai/ui/weekly-usage-chart"));

/** Where course rows and "View all" go: the courses list every admin uses. */
const COURSES_HREF = "/instructor";

export const AI_TUTOR_ADMIN_ONBOARDING_TASKS: OnboardingTask[] = [
  { id: "admin.check-api-key", label: "Check the EduAI API key", href: "/admin?tab=ai-settings" },
  {
    id: "admin.review-models",
    label: "Review tutor and reviewer models",
    href: "/admin?tab=ai-settings",
  },
  { id: "admin.look-at-oversight", label: "Look at AI oversight", href: "/admin?tab=ai-oversight" },
  { id: "admin.triage-bug-reports", label: "Triage bug reports", href: "/admin?tab=bug-reports" },
];

const HEALTH_BADGE = {
  ok: { variant: "success", label: "OK" },
  failed: { variant: "destructive", label: "Failed" },
  "not-set": { variant: "muted", label: "Not set" },
} satisfies Record<AdminHealthItem["status"], { variant: BadgeVariant; label: string }>;

// ── Shared bits ─────────────────────────────────────────────────────────────

function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
    >
      {children} <IconChevronRight size={13} aria-hidden />
    </Link>
  );
}

function CardNote({ children }: { children: ReactNode }) {
  return <p className="-mt-2 mb-3 text-xs text-muted-foreground">{children}</p>;
}

function Unavailable() {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      Couldn&apos;t load this right now.
    </p>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// ── Row 1 ───────────────────────────────────────────────────────────────────

function CoursesSummaryCard({
  stats,
  fallbackTotal,
}: {
  stats: DashboardStats | null;
  fallbackTotal: number;
}) {
  const total = stats?.totalCourses ?? fallbackTotal;
  const published = stats?.publishedCourses;
  const unpublished = stats?.draftCourses;
  return (
    <PanelCard
      title="Courses"
      className="h-full"
      action={<IconBooks size={18} className="text-muted-foreground" aria-hidden />}
    >
      <div className="text-3xl font-semibold text-foreground tabular-nums">{total}</div>
      {published !== undefined && unpublished !== undefined && (
        <p className="mt-2 text-sm text-muted-foreground">
          {published} published · {unpublished} unpublished
        </p>
      )}
      <div className="mt-4">
        <CardLink to={COURSES_HREF}>View courses</CardLink>
      </div>
    </PanelCard>
  );
}

function ContentTutoringCard({ data }: { data: AdminDashboardData | null }) {
  return (
    <PanelCard title="Content & tutoring" className="h-full">
      {!data ? (
        <Unavailable />
      ) : (
        <div className="grid grid-cols-2 gap-4 @3xl/dashboard:grid-cols-4 @3xl/dashboard:divide-x @3xl/dashboard:divide-border @3xl/dashboard:[&>*:not(:first-child)]:pl-4">
          <Stat label="Activities" value={data.content.activities} sub="across all courses" />
          <Stat
            label="Tutoring sessions"
            value={data.tutoring.sessions}
            sub={`${data.tutoring.sessionsThisWeek} this week · ${data.tutoring.learnersThisWeek} ${
              data.tutoring.learnersThisWeek === 1 ? "learner" : "learners"
            }`}
          />
          <Stat
            label="Submissions"
            value={data.submissions.total}
            sub={`${data.submissions.toReview} to grade`}
          />
          <Stat
            label="Average rating"
            value={data.ratings.average === null ? "—" : data.ratings.average.toFixed(1)}
            sub={`${data.ratings.count} ${data.ratings.count === 1 ? "rating" : "ratings"}`}
          />
        </div>
      )}
    </PanelCard>
  );
}

// ── Row 2 ───────────────────────────────────────────────────────────────────

function AttentionRow({ item }: { item: AdminAttentionItem }) {
  const variant: BadgeVariant = item.count === 0 ? "success" : item.severity;
  return (
    <li>
      <Link
        to={item.href}
        className="flex items-center gap-3 py-3 transition-colors hover:bg-muted/40"
      >
        <Badge variant={variant} className="min-w-6 justify-center tabular-nums">
          {item.count}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{item.title}</div>
          <div className="truncate text-xs text-muted-foreground">{item.description}</div>
        </div>
        <IconChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

function AttentionCard({ items }: { items: AdminAttentionItem[] | null }) {
  return (
    <PanelCard title="Needs your attention" className="h-full">
      <CardNote>Items in AI Tutor that may need an administrator.</CardNote>
      {!items ? (
        <Unavailable />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function HealthCard({ items }: { items: AdminHealthItem[] | null }) {
  return (
    <PanelCard
      title="AI tutor health"
      className="h-full"
      action={<CardLink to="/admin?tab=ai-settings">View AI settings</CardLink>}
    >
      <CardNote>The key, model catalog and models the tutor runs on.</CardNote>
      {!items ? (
        <Unavailable />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const badge = HEALTH_BADGE[item.status];
            return (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <IconSparkles size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{item.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

// ── Row 3 ───────────────────────────────────────────────────────────────────

function UsageCard({ weeks }: { weeks: AdminDashboardData["weeklySessions"] | null }) {
  const placeholder = <div className="h-full animate-pulse rounded-md bg-muted" />;
  return (
    <PanelCard title="Usage" className="h-full">
      <CardNote>Tutoring sessions per week · Last 6 months</CardNote>
      {!weeks ? (
        <Unavailable />
      ) : (
        <div
          className="h-64"
          role="img"
          aria-label="Tutoring sessions per week over the last 6 months"
        >
          <Suspense fallback={placeholder}>
            <WeeklyUsageChart data={weeks} seriesLabel="Tutoring sessions" />
          </Suspense>
        </div>
      )}
    </PanelCard>
  );
}

/** Rows the Courses card shows before "View all". */
const COURSE_CARD_ROWS = 4;

function CoursesCard({ courses, courseTotal }: { courses: Course[]; courseTotal?: number }) {
  return (
    <PanelCard
      title="Courses"
      className="h-full"
      action={<CardLink to={COURSES_HREF}>View all</CardLink>}
    >
      <div className="-mx-5 -mb-5 border-t border-border">
        <CourseListPanel
          courses={courses.slice(0, COURSE_CARD_ROWS).map(toDashboardCourseRow)}
          loading={false}
          coursesHref={COURSES_HREF}
          framed={false}
        />
        {/* #1208: say the list is a preview rather than ending it silently. */}
        <TruncatedListNotice
          className="px-5 pb-4"
          shown={Math.min(courses.length, COURSE_CARD_ROWS)}
          total={courseTotal}
          action="browse all courses to find the rest"
        />
      </div>
    </PanelCard>
  );
}

// ── Row 4 ───────────────────────────────────────────────────────────────────

function RecentAiActivityCard({ traces }: { traces: AiTraceRow[] | null }) {
  return (
    <PanelCard
      title="Recent AI activity"
      className="h-full"
      action={<CardLink to="/admin?tab=ai-oversight">All interactions</CardLink>}
    >
      <CardNote>Latest tutor replies across all courses.</CardNote>
      {!traces ? (
        <Unavailable />
      ) : traces.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No tutor activity yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {traces.map((trace) => (
            <li key={trace.id} className="flex items-start gap-3 py-3">
              <IconMessageChatbot
                size={16}
                className="mt-0.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">
                  <span className="font-semibold">{trace.activity?.title ?? "Activity"}</span>
                  {trace.courseTitle ? ` · ${trace.courseTitle}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {trace.user?.name ?? "Unknown user"}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {trace.finalOutcome && (
                  <Badge variant={outcomeBadgeVariant(trace.finalOutcome)}>
                    {formatLabel(trace.finalOutcome)}
                  </Badge>
                )}
                {trace.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(trace.createdAt)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export type AdminDashboardProps = {
  userId: string;
  courses: Course[];
  /** Every course, for the Courses card's "showing N of M" notice (#1208). */
  courseTotal?: number;
  /** Course and bug-report totals, already resolved against Core; `null` if that call failed. */
  dashboardStats: DashboardStats | null;
  /** `null` if `GET /api/admin/dashboard` failed; those cards say so instead of breaking the page. */
  data: AdminDashboardData | null;
  /** The five latest tutor replies, or `null` if they could not be loaded. */
  recentTraces: AiTraceRow[] | null;
};

export function AdminDashboard({
  userId,
  courses,
  courseTotal,
  dashboardStats,
  data,
  recentTraces,
}: AdminDashboardProps) {
  const navigate = useNavigate();
  // Unhandled bug reports come from Core (AI Tutor-sourced only), via the stats call.
  const openBugReports = dashboardStats?.openBugReports;
  const attention: AdminAttentionItem[] | null = data
    ? [
        ...(openBugReports === undefined
          ? []
          : [
              {
                id: "unhandled-bug-reports",
                title: "Unhandled bug reports",
                description:
                  openBugReports > 0
                    ? `${openBugReports} ${openBugReports === 1 ? "report needs" : "reports need"} triage.`
                    : "No reports waiting for triage.",
                count: openBugReports,
                severity: "destructive" as const,
                href: "/admin?tab=bug-reports",
              },
            ]),
        ...data.attention,
      ]
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 @3xl/dashboard:grid-cols-[1fr_2fr]">
        <CoursesSummaryCard stats={dashboardStats} fallbackTotal={courses.length} />
        <ContentTutoringCard data={data} />
      </div>
      <div className="grid gap-5 @3xl/dashboard:grid-cols-[3fr_2fr]">
        <AttentionCard items={attention} />
        <HealthCard items={data?.health ?? null} />
      </div>
      <div className="grid gap-5 @3xl/dashboard:grid-cols-[2fr_1fr]">
        <UsageCard weeks={data?.weeklySessions ?? null} />
        <CoursesCard courses={courses} courseTotal={courseTotal} />
      </div>
      <div className="grid gap-5 @3xl/dashboard:grid-cols-[3fr_2fr] @3xl/dashboard:items-start">
        <RecentAiActivityCard traces={recentTraces} />
        <OnboardingChecklist
          platform="ai-tutor"
          role="ADMIN"
          userId={userId}
          navigate={navigate}
          tasks={AI_TUTOR_ADMIN_ONBOARDING_TASKS}
          layout="inline"
          intro="Open a task, then tick its circle when you have finished."
        />
      </div>
    </div>
  );
}
