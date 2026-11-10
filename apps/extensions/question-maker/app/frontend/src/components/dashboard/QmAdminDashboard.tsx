/**
 * @file The ADMIN dashboard, in Core's and AI Tutor's admin dashboard layout
 * but about Question Maker only: needs your attention + AI health; content +
 * courses & assessments; question versions per week; recent activity +
 * getting started. Every card is the shared `PanelCard` with `Badge` and the
 * inline `OnboardingChecklist`, so styling stays on the design system. Users
 * are managed in Core, so they are not shown here.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  IconChevronRight,
  IconClipboardList,
  IconFileText,
  IconSparkles,
} from "@tabler/icons-react";
import {
  Badge,
  OnboardingChecklist,
  PageHeading,
  PanelCard,
  type BadgeVariant,
  type OnboardingTask,
} from "@eduai/ui";

import {
  adminDashboardService,
  type AdminAttentionItem,
  type AdminDashboardData,
  type AdminHealthItem,
  type AdminHealthStatus,
  type AdminRecentItem,
} from "@/services/adminDashboardService";
import { relativeTime } from "./QmDashboardView";

const WeeklyUsageChart = lazy(() => import("@eduai/ui/weekly-usage-chart"));

export const QM_ADMIN_HERO_COPY = {
  heading: "Question Maker overview",
  subheading: "Question Maker content, AI health and usage at a glance.",
};

export const QM_ADMIN_ONBOARDING_TASKS: OnboardingTask[] = [
  { id: "admin.triage-bug-reports", label: "Triage bug reports", href: "/admin/bug-reports" },
  { id: "admin.check-ai-settings", label: "Check AI settings", href: "/settings" },
  { id: "admin.browse-courses", label: "Browse courses", href: "/courses" },
  { id: "admin.open-library", label: "Open the question library", href: "/library" },
];

const HEALTH_BADGE = {
  ok: { variant: "success", label: "OK" },
  degraded: { variant: "warning", label: "Degraded" },
  failed: { variant: "destructive", label: "Failed" },
  "not-set": { variant: "muted", label: "Not set" },
} satisfies Record<AdminHealthStatus, { variant: BadgeVariant; label: string }>;

const USAGE_SERIES = [
  { key: "ai", label: "AI-generated" },
  { key: "manual", label: "Written by hand" },
];

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

/** What a card shows while the rollup loads, or when it failed. */
function CardBody({
  data,
  state,
  children,
}: {
  data: AdminDashboardData | null;
  state: "loading" | "error" | "ready";
  children: (loaded: AdminDashboardData) => ReactNode;
}) {
  if (state === "loading") {
    return <div className="h-24 animate-pulse rounded-md bg-muted" aria-hidden />;
  }
  if (state === "error" || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Couldn&apos;t load this right now.
      </p>
    );
  }
  return <>{children(data)}</>;
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type CardProps = { data: AdminDashboardData | null; state: "loading" | "error" | "ready" };

// ── Row 1 ───────────────────────────────────────────────────────────────────

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

function AttentionCard({ data, state }: CardProps) {
  return (
    <PanelCard title="Needs your attention" className="h-full">
      <CardNote>Items in Question Maker that may need an administrator.</CardNote>
      <CardBody data={data} state={state}>
        {(loaded) => (
          <ul className="divide-y divide-border">
            {loaded.attention.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardBody>
    </PanelCard>
  );
}

function HealthRow({ item }: { item: AdminHealthItem }) {
  const badge = HEALTH_BADGE[item.status] ?? HEALTH_BADGE["not-set"];
  return (
    <li className="flex items-center gap-3 py-3">
      <IconSparkles size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
      </div>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </li>
  );
}

function HealthCard({ data, state }: CardProps) {
  return (
    <PanelCard
      title="AI health"
      className="h-full"
      action={<CardLink to="/settings">View AI settings</CardLink>}
    >
      <CardNote>The AI services, key and models question generation runs on.</CardNote>
      <CardBody data={data} state={state}>
        {(loaded) => (
          <ul className="divide-y divide-border">
            {loaded.health.map((item) => (
              <HealthRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardBody>
    </PanelCard>
  );
}

// ── Row 2 ───────────────────────────────────────────────────────────────────

function ContentCard({ data, state }: CardProps) {
  return (
    <PanelCard
      title="Content"
      className="h-full"
      action={<CardLink to="/library">Question library</CardLink>}
    >
      <CardBody data={data} state={state}>
        {(loaded) => {
          const { content } = loaded;
          const aiShare =
            content.versions === 0
              ? "—"
              : `${Math.round((content.aiGenerated / content.versions) * 100)}%`;
          return (
            <div className="grid grid-cols-2 gap-4 @3xl/dashboard:grid-cols-4 @3xl/dashboard:divide-x @3xl/dashboard:divide-border @3xl/dashboard:[&>*:not(:first-child)]:pl-4">
              <Stat label="Questions" value={content.questions} sub="across all courses" />
              <Stat
                label="Versions"
                value={content.versions}
                sub={`${content.reviewed} reviewed · ${plural(content.drafts, "draft", "drafts")}`}
              />
              <Stat
                label="Made by AI"
                value={aiShare}
                sub={`${content.aiGenerated} of ${plural(content.versions, "version", "versions")}`}
              />
              <Stat label="Shared" value={content.shared} sub="versions other apps can use" />
            </div>
          );
        }}
      </CardBody>
    </PanelCard>
  );
}

function CoursesAssessmentsCard({ data, state }: CardProps) {
  return (
    <PanelCard
      title="Courses & assessments"
      className="h-full"
      action={<CardLink to="/courses">View courses</CardLink>}
    >
      <CardBody data={data} state={state}>
        {(loaded) => {
          const { courses, assessments } = loaded;
          const types = assessments.byType
            .filter((row) => row.count > 0)
            .map((row) => `${row.count} ${row.type}`)
            .join(" · ");
          return (
            <div className="grid grid-cols-3 gap-4 divide-x divide-border [&>*:not(:first-child)]:pl-4">
              <Stat
                label="Courses"
                value={courses.total}
                sub={`${courses.withQuestions} with questions`}
              />
              <Stat
                label="Linked to Canvas"
                value={courses.canvasLinked}
                sub={`of ${plural(courses.total, "course", "courses")}`}
              />
              <Stat label="Assessments" value={assessments.total} sub={types || "None yet"} />
            </div>
          );
        }}
      </CardBody>
    </PanelCard>
  );
}

// ── Row 3 ───────────────────────────────────────────────────────────────────

function UsageCard({ data, state }: CardProps) {
  const placeholder = <div className="h-full animate-pulse rounded-md bg-muted" />;
  return (
    <PanelCard title="Usage">
      <CardNote>Question versions created per week · Last 6 months</CardNote>
      <CardBody data={data} state={state}>
        {(loaded) => (
          <div
            className="h-64"
            role="img"
            aria-label="Question versions created per week over the last 6 months, AI-generated and written by hand"
          >
            <Suspense fallback={placeholder}>
              <WeeklyUsageChart data={loaded.weeklyVersions} series={USAGE_SERIES} />
            </Suspense>
          </div>
        )}
      </CardBody>
    </PanelCard>
  );
}

// ── Row 4 ───────────────────────────────────────────────────────────────────

function RecentRow({ item }: { item: AdminRecentItem }) {
  const Icon = item.kind === "question" ? IconFileText : IconClipboardList;
  const kind = item.kind === "question" ? "Question" : "Assessment";
  return (
    <li>
      <Link
        to={item.href}
        className="flex items-start gap-3 py-3 transition-colors hover:bg-muted/40"
      >
        <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{item.label}</div>
          <div className="text-xs text-muted-foreground">
            {item.by ? `${kind} · ${item.by}` : kind}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {relativeTime(item.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

function RecentActivityCard({ data, state }: CardProps) {
  return (
    <PanelCard title="Recent activity" className="h-full">
      <CardNote>Latest questions and assessments edited across all courses.</CardNote>
      <CardBody data={data} state={state}>
        {(loaded) =>
          loaded.recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {loaded.recentActivity.map((item) => (
                <RecentRow key={item.id} item={item} />
              ))}
            </ul>
          )
        }
      </CardBody>
    </PanelCard>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function QmAdminDashboard({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [state, setState] = useState<CardProps["state"]>("loading");

  useEffect(() => {
    let cancelled = false;
    adminDashboardService
      .get()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = { data, state };
  return (
    <div className="@container/dashboard flex flex-1 flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading
        heading={QM_ADMIN_HERO_COPY.heading}
        subheading={QM_ADMIN_HERO_COPY.subheading}
      />
      <div className="flex flex-col gap-5">
        {/* What needs acting on comes first; the headline numbers follow. */}
        <div className="grid gap-5 @3xl/dashboard:grid-cols-[3fr_2fr]">
          <AttentionCard {...cards} />
          <HealthCard {...cards} />
        </div>
        <div className="grid gap-5 @3xl/dashboard:grid-cols-[2fr_1fr]">
          <ContentCard {...cards} />
          <CoursesAssessmentsCard {...cards} />
        </div>
        <UsageCard {...cards} />
        <div className="grid gap-5 @3xl/dashboard:grid-cols-[3fr_2fr] @3xl/dashboard:items-start">
          <RecentActivityCard {...cards} />
          <OnboardingChecklist
            platform="question-maker"
            role="ADMIN"
            userId={userId}
            navigate={navigate}
            tasks={QM_ADMIN_ONBOARDING_TASKS}
            layout="inline"
            intro="Open a task, then tick its circle when you have finished."
          />
        </div>
      </div>
    </div>
  );
}
