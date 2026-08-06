/**
 * @file Shared, props-driven dashboard shell — the AI Tutor counterpart of
 * Core's `DashboardView` (`apps/core/app/components/dashboard/dashboard-view.tsx`)
 * and QM's `QmDashboardView`. Pure presentational: every role-specific view
 * (`DashboardStudentView`, `DashboardInstructorView`, ...) derives its stats and
 * panels from real `api.*` responses and passes them in here. No fetching, no
 * fabricated numbers.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { IconChevronRight } from '@tabler/icons-react';
import { StatCard, termLabel, QuickActionsPanel, type QuickAction } from '@eduai/ui';
import { TruncatedListNotice } from '~/components/common/TruncatedListNotice';

export type DashboardStatDef = {
  label: string;
  value: string | number;
};

export type DashboardCourseRow = {
  id: number;
  code: string;
  name: string;
  term: string;
  year: number | null;
  accentColor: string;
  /** e.g. "42% complete" — omitted entirely for roles with no per-course progress. */
  progressLabel?: string | null;
};

/** @deprecated Use `QuickAction` from `@eduai/ui`. Kept as an alias for existing role-view imports. */
export type DashboardQuickAction = QuickAction;

export type DashboardViewProps = {
  stats: DashboardStatDef[];
  /** Optional analytics row (DonutChart/MeterBar panels) rendered below the stat grid. */
  analytics?: ReactNode;
  courses: DashboardCourseRow[];
  coursesLoading?: boolean;
  /** "Browse all" link target for the course-list panel. */
  coursesHref: string;
  leftPanelTitle: string;
  /**
   * Full course count (#1208). Supply it when the role's `rightPanel` isn't a
   * course panel that already discloses the bound — otherwise the disclosure
   * would render twice on the same screen. `courses` is one bounded page, so
   * without this the list truncates silently.
   */
  courseTotal?: number;
  quickActions: DashboardQuickAction[];
  rightPanelTitle: string;
  rightPanel: ReactNode;
};

function CourseListSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
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

function CourseListPanel({
  courses,
  loading,
  coursesHref,
}: {
  courses: DashboardCourseRow[];
  loading: boolean;
  coursesHref: string;
}) {
  if (loading) return <CourseListSkeleton />;

  if (courses.length === 0) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-border bg-card px-5 py-8 text-center shadow-[var(--shadow-2xs)]">
        <p className="text-sm text-muted-foreground">No courses found.</p>
        <Link
          to={coursesHref}
          className="mt-2 inline-block text-xs font-medium text-primary-text hover:underline"
        >
          Browse courses →
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {courses.slice(0, 5).map((course) => (
        <Link
          key={course.id}
          to={`${coursesHref}/courses/${course.id}`}
          className="flex items-center gap-4 border-b border-border px-5 py-[14px] transition-all duration-200 last:border-b-0 hover:-translate-y-px hover:bg-muted/40"
        >
          <div
            className="h-11 w-1 flex-shrink-0 rounded-sm"
            style={{ background: course.accentColor }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{course.code}</span>
              {(course.term || course.year) && (
                <span className="text-[11px] text-muted-foreground">
                  {termLabel(course.term, course.year)}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{course.name}</div>
          </div>
          {course.progressLabel && (
            <span className="flex-shrink-0 text-xs font-medium text-muted-foreground">
              {course.progressLabel}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

export function DashboardView({
  stats,
  analytics,
  courses,
  coursesLoading = false,
  coursesHref,
  leftPanelTitle,
  courseTotal,
  quickActions,
  rightPanelTitle,
  rightPanel,
}: DashboardViewProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {/* Analytics row */}
      {analytics}

      {/* 2-column body */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Left — your courses + quick actions */}
        <div className="flex flex-col gap-6">
          <div>
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">{leftPanelTitle}</h2>
              <Link
                to={coursesHref}
                className="flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline"
              >
                Browse all <IconChevronRight size={13} />
              </Link>
            </div>
            <CourseListPanel courses={courses} loading={coursesLoading} coursesHref={coursesHref} />
            {!coursesLoading && courseTotal !== undefined && (
              <TruncatedListNotice
                className="mt-2.5"
                shown={courses.length}
                total={courseTotal}
                action="browse all courses to find the rest"
              />
            )}
          </div>

          <div>
            <h2 className="mb-3.5 text-[15px] font-semibold text-foreground">Quick actions</h2>
            <QuickActionsPanel actions={quickActions} LinkComponent={Link} />
          </div>
        </div>

        {/* Right — role-specific resume/attention panel */}
        <div className="flex flex-col">
          <h2 className="mb-3.5 text-[15px] font-semibold text-foreground">{rightPanelTitle}</h2>
          {rightPanel}
        </div>
      </div>
    </div>
  );
}
