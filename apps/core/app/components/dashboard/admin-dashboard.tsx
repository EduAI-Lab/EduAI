/**
 * @file The ADMIN dashboard: four rows of paired cards (needs your attention +
 * system health; users + courses & materials; usage + courses; recent
 * activity + getting started). Layout follows the admin redesign; every card is
 * the existing `PanelCard` with `Badge`, `CourseListPanel` and
 * `OnboardingChecklist` reused inside, so styling stays on the design system.
 * All data arrives resolved from the route loader (`loadAdminDashboardData`).
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  IconActivity,
  IconAlertTriangle,
  IconChevronRight,
  IconFileText,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import {
  Badge,
  OnboardingChecklist,
  PanelCard,
  type BadgeVariant,
  type OnboardingTask,
} from "@eduai/ui";

import { CourseListPanel } from "~/components/dashboard/dashboard-view";
import { formatRelativeTime, useFormatScope } from "~/lib/hydration-format";
import { auditActionLabel } from "~/lib/audit-action-labels";
import type {
  AdminAttentionItem,
  AdminDashboardData,
  AdminHealthItem,
  AdminHealthStatus,
} from "~/types/admin-dashboard";

const AdminUsageChart = lazy(() => import("~/components/dashboard/admin-usage-chart"));

export const ADMIN_HERO_COPY = {
  heading: "Core overview",
  subheading: "EduAI platform health and usage at a glance.",
};

export const ADMIN_ONBOARDING_TASKS: OnboardingTask[] = [
  { id: "admin.invite-user", label: "Invite a user", href: "/admin/invitations" },
  { id: "admin.review-roles", label: "Review user roles", href: "/admin/users" },
  { id: "admin.check-ai-models", label: "Check AI models", href: "/admin/ai-models" },
  { id: "admin.review-bug-reports", label: "Review bug reports", href: "/admin/bug-reports" },
];

const HEALTH_BADGE = {
  ok: { variant: "success", label: "OK" },
  failed: { variant: "destructive", label: "Failed" },
  degraded: { variant: "warning", label: "Degraded" },
  "not-set": { variant: "muted", label: "Not set" },
} satisfies Record<AdminHealthStatus, { variant: BadgeVariant; label: string }>;

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
  return <p className="-mt-1.5 mb-2 text-xs text-muted-foreground">{children}</p>;
}

/** Relative times depend on the wall clock, so server and client may differ by a minute. */
function TimeAgo({ iso }: { iso: string }) {
  const formatScope = useFormatScope();
  return <span suppressHydrationWarning>{formatRelativeTime(iso, formatScope)}</span>;
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// ── Row 1 ───────────────────────────────────────────────────────────────────

function UsersCard({ users }: { users: AdminDashboardData["users"] }) {
  const { students, instructors, admins, other } = users.byRole;
  const breakdown = [
    `${students} ${students === 1 ? "student" : "students"}`,
    `${instructors} ${instructors === 1 ? "instructor" : "instructors"}`,
    `${admins} ${admins === 1 ? "admin" : "admins"}`,
    `${other} other`,
  ].join(" · ");
  return (
    <PanelCard
      title="Users"
      className="h-full"
      action={<IconUsers size={18} className="text-muted-foreground" aria-hidden />}
    >
      <div className="text-3xl font-semibold text-foreground tabular-nums">{users.total}</div>
      <p className="mt-2 text-sm text-muted-foreground">{breakdown}</p>
      <div className="mt-4">
        <CardLink to="/admin/users">Manage users</CardLink>
      </div>
    </PanelCard>
  );
}

function CoursesMaterialsCard({ data }: { data: AdminDashboardData }) {
  return (
    <PanelCard
      title="Courses & materials"
      className="h-full"
      action={<CardLink to="/courses">View details</CardLink>}
    >
      <div className="grid grid-cols-3 gap-4 divide-x divide-border [&>*:not(:first-child)]:pl-4">
        <Stat
          label="Courses"
          value={data.courses.total}
          sub={`${data.courses.published} published`}
        />
        <Stat
          label="Materials"
          value={data.materials.total}
          sub={`${data.materials.ready} ready`}
        />
        <Stat
          label="AI sessions"
          value={data.aiSessions.total}
          sub={`${data.aiSessions.thisWeek} this week`}
        />
      </div>
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
        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/40"
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

function AttentionCard({ items }: { items: AdminAttentionItem[] }) {
  return (
    <PanelCard
      title="Needs your attention"
      // Set apart from the other cards: a warning-tinted border and header.
      className="h-full border-[var(--color-warning-500)]"
      titleClassName="text-[var(--color-warning-700)]"
      icon={<IconAlertTriangle size={18} aria-hidden />}
    >
      <CardNote>Items that may need an administrator.</CardNote>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </ul>
    </PanelCard>
  );
}

function healthLine(item: AdminHealthItem): ReactNode {
  if (item.kind === "cron") {
    if (!item.lastRunAt) return item.detail;
    const verb = item.status === "failed" ? "Failed" : "Last run";
    return (
      <>
        {item.detail ? `${item.detail} · ` : ""}
        {verb} <TimeAgo iso={item.lastRunAt} />
      </>
    );
  }
  if (item.lastRunAt) {
    return (
      <>
        {item.detail ? `${item.detail} ` : ""}Checked <TimeAgo iso={item.lastRunAt} />
      </>
    );
  }
  return item.detail;
}

function HealthCard({ items }: { items: AdminHealthItem[] }) {
  return (
    <PanelCard
      title="System health"
      className="h-full"
      action={<CardLink to="/admin/cron-jobs">View cron jobs</CardLink>}
    >
      <CardNote>Scheduled jobs and connected AI services.</CardNote>
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const badge = HEALTH_BADGE[item.status];
          const Icon = item.kind === "cron" ? IconActivity : IconSparkles;
          return (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{healthLine(item)}</div>
              </div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </li>
          );
        })}
      </ul>
    </PanelCard>
  );
}

// ── Row 3 ───────────────────────────────────────────────────────────────────

function UsageCard({ data }: { data: AdminDashboardData["weeklyChats"] }) {
  // recharts measures the DOM, so the chart mounts after hydration; the server
  // and the first client render both paint the placeholder.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const placeholder = <div className="h-full animate-pulse rounded-md bg-muted" />;
  return (
    <PanelCard title="Usage" className="h-full">
      <CardNote>AI chats per week · Last 6 months</CardNote>
      <div className="h-64" role="img" aria-label="AI chats per week over the last 6 months">
        {!mounted ? (
          placeholder
        ) : (
          <Suspense fallback={placeholder}>
            <AdminUsageChart data={data} />
          </Suspense>
        )}
      </div>
    </PanelCard>
  );
}

function CoursesCard({ courses }: { courses: AdminDashboardData["courseList"] }) {
  return (
    <PanelCard
      title="Courses"
      className="h-full"
      action={<CardLink to="/courses">View all</CardLink>}
    >
      <div className="-mx-5 -mb-5 border-t border-border">
        <CourseListPanel courses={courses} loading={false} title="Courses" framed={false} />
      </div>
    </PanelCard>
  );
}

// ── Row 4 ───────────────────────────────────────────────────────────────────

function RecentActivityCard({ entries }: { entries: AdminDashboardData["recentActivity"] }) {
  return (
    <PanelCard
      title="Recent activity"
      className="h-full"
      action={<CardLink to="/admin/logs">All logs</CardLink>}
    >
      <CardNote>Latest administrative changes.</CardNote>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-2.5">
              <IconFileText
                size={16}
                className="mt-0.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">
                  <span className="font-semibold">{auditActionLabel(entry.actionCode)}</span>
                  {entry.entityLabel ? `: ${entry.entityLabel}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {entry.actorName ?? "Unknown user"}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                <TimeAgo iso={entry.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function AdminDashboard({ data, userId }: { data: AdminDashboardData; userId: string }) {
  const navigate = useNavigate();
  return (
    <div className="@container/dashboard flex flex-col gap-4 px-4 pb-6 lg:px-6">
      {/* What needs acting on comes first; the headline numbers follow. */}
      <div className="grid gap-4 @3xl/dashboard:grid-cols-[3fr_2fr]">
        <AttentionCard items={data.attention} />
        <HealthCard items={data.health} />
      </div>
      <div className="grid gap-4 @3xl/dashboard:grid-cols-[1fr_2fr]">
        <UsersCard users={data.users} />
        <CoursesMaterialsCard data={data} />
      </div>
      <div className="grid gap-4 @3xl/dashboard:grid-cols-[2fr_1fr]">
        <UsageCard data={data.weeklyChats} />
        <CoursesCard courses={data.courseList} />
      </div>
      <div className="grid gap-4 @3xl/dashboard:grid-cols-[3fr_2fr] @3xl/dashboard:items-start">
        <RecentActivityCard entries={data.recentActivity} />
        <OnboardingChecklist
          platform="core"
          role="ADMIN"
          userId={userId}
          navigate={navigate}
          tasks={ADMIN_ONBOARDING_TASKS}
          layout="inline"
          intro="Open a task, then tick its circle when you have finished."
        />
      </div>
    </div>
  );
}
