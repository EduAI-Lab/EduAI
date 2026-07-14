/**
 * Presentational QM dashboard. Mirrors Core's DashboardView layout but is
 * fully props-driven (no service calls) and surfaces recent questions/assessments
 * instead of chats — QM has no chat. Adds an at-a-glance analytics row and a
 * first-run onboarding state when the user has no courses yet.
 */
import { Link } from 'react-router';
import {
  IconChevronRight,
  IconHistory,
  IconArrowRight,
  IconSparkles,
} from '@tabler/icons-react';
import { StatCard, COURSE_COLORS, Button, QuestionAnalytics, QuickActionsPanel, type QuickAction, type DonutSegment } from '@eduai/ui';

export type QmDashboardStat = {
  label: string;
  value: string | number;
};

export type QmDashboardCourse = {
  id: number;
  code: string;
  name: string;
};

export type QmDashboardRecentItem = {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  updatedAt: string;
};

/** @deprecated Use `QuickAction` from `@eduai/ui`. Kept as an alias for existing imports. */
export type QmDashboardQuickAction = QuickAction;

export type QmDashboardAnalytics = {
  typeComposition: DonutSegment[];
  difficulty: { label: string; value: number; color: string }[];
  totalQuestions: number;
  totalVariants: number;
  aiCount: number;
  humanCount: number;
  reviewedCount: number;
};

export type QmDashboardViewProps = {
  greetingName?: string;
  stats: QmDashboardStat[];
  courses: QmDashboardCourse[];
  coursesLoading?: boolean;
  recentItems: QmDashboardRecentItem[];
  recentLoading?: boolean;
  quickActions: QmDashboardQuickAction[];
  analytics?: QmDashboardAnalytics;
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function AnalyticsSection({ analytics }: { analytics: QmDashboardAnalytics }) {
  // Global dashboard: no topicCoverage → renders the 3-panel layout.
  return <QuestionAnalytics {...analytics} />;
}

function OnboardingCard({ hasCourses }: { hasCourses: boolean }) {
  const steps = [
    { n: 1, title: 'Open a course', body: 'Your EduAI courses appear automatically — pick one to start.', tile: 'bg-secondary/15 text-secondary' },
    { n: 2, title: 'Add questions', body: 'Write them yourself or let AI draft a first pass you can refine.', tile: 'bg-accent/15 text-accent' },
    { n: 3, title: 'Build assessments', body: 'Assemble questions into quizzes and exams, then export or push to Canvas.', tile: 'bg-[var(--color-gold-500)]/15 text-[var(--color-gold-600)]' },
  ];
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      <div className="flex flex-col gap-3 border-b border-border bg-gradient-to-br from-secondary/[0.10] via-accent/[0.05] to-transparent p-6 md:p-8">
        <div className="flex size-11 items-center justify-center rounded-[var(--radius-lg)] bg-gradient-to-br from-secondary to-accent text-white shadow-[var(--shadow-sm)]">
          <IconSparkles className="size-6" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Welcome to Question Maker</h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Build, vary, and assemble course questions — with AI on tap. Here's how to get rolling.
        </p>
        <div className="mt-1">
          <Button asChild>
            <Link to="/courses">
              {hasCourses ? 'Go to your courses' : 'Browse your courses'}
              <IconArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="bg-card p-5">
            <div className={`mb-2 flex size-6 items-center justify-center rounded-full text-xs font-bold ${s.tile}`}>
              {s.n}
            </div>
            <div className="text-sm font-semibold text-foreground">{s.title}</div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">{s.body}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CourseListPanel({ courses, loading }: { courses: QmDashboardCourse[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex animate-pulse items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
            <div className="h-11 w-1 flex-shrink-0 rounded-sm bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-24 rounded bg-muted" />
              <div className="h-3 w-48 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {courses.slice(0, 5).map((course, i) => (
        <Link
          key={course.id}
          to={`/courses/${course.id}`}
          className="flex items-center gap-4 border-b border-border px-5 py-[14px] transition-colors last:border-b-0 hover:bg-muted/40"
        >
          <div
            className="h-11 w-1 flex-shrink-0 rounded-sm"
            style={{ background: COURSE_COLORS[i % COURSE_COLORS.length] }}
          />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold text-foreground">{course.code}</span>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{course.name}</div>
          </div>
          <IconChevronRight size={16} className="flex-shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

function RecentActivityPanel({ items, loading }: { items: QmDashboardRecentItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse space-y-2 border-b border-border px-5 py-[14px] last:border-b-0">
            <div className="flex justify-between">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-3 w-12 rounded bg-muted" />
            </div>
            <div className="h-3.5 w-4/5 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <IconHistory size={24} className="mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No recent activity yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <Link
              key={item.id}
              to={item.href}
              className="block w-full border-b border-border px-5 py-[14px] text-left transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="flex-shrink-0 text-[10px] font-semibold text-primary-text">
                  {item.sublabel ?? 'Activity'}
                </span>
                <span className="ml-2 flex-shrink-0 text-[11px] text-muted-foreground">
                  {relativeTime(item.updatedAt)}
                </span>
              </div>
              <p className="line-clamp-2 text-[13px] leading-snug text-foreground">{item.label}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function QmDashboardView({
  greetingName,
  stats,
  courses,
  coursesLoading = false,
  recentItems,
  recentLoading = false,
  quickActions,
  analytics,
}: QmDashboardViewProps) {
  const now = new Date();
  const hello = greetingName ? `${greeting(now.getHours())}, ${greetingName}` : greeting(now.getHours());
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const showOnboarding = !coursesLoading && courses.length === 0;
  const showAnalytics = Boolean(analytics && analytics.totalQuestions > 0);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      {/* Hero */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{hello}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{dateLabel}</p>
      </div>

      {showOnboarding ? (
        <>
          <OnboardingCard hasCourses={courses.length > 0} />
          <div>
            <h2 className="mb-3.5 text-[15px] font-semibold text-foreground">Quick actions</h2>
            <QuickActionsPanel actions={quickActions} LinkComponent={Link} />
          </div>
        </>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} />
            ))}
          </div>

          {/* Analytics */}
          {showAnalytics && analytics && <AnalyticsSection analytics={analytics} />}

          {/* 2-column body */}
          <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-stretch">
            <div className="flex flex-col gap-6">
              <div>
                <div className="mb-3.5 flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-foreground">Your courses</h2>
                  <Link
                    to="/courses"
                    className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
                  >
                    Browse all <IconChevronRight size={13} />
                  </Link>
                </div>
                <CourseListPanel courses={courses} loading={coursesLoading} />
              </div>

              <div>
                <h2 className="mb-3.5 text-[15px] font-semibold text-foreground">Quick actions</h2>
                <QuickActionsPanel actions={quickActions} LinkComponent={Link} />
              </div>
            </div>

            <div className="flex h-full flex-col">
              <h2 className="mb-3.5 text-[15px] font-semibold text-foreground">Recent activity</h2>
              <div className="flex-1">
                <RecentActivityPanel items={recentItems} loading={recentLoading} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
