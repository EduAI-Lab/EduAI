// Mirrors apps/extensions/ai-tutor/app/components/dashboard/TeachingDashboard.tsx
/**
 * Presentational QM dashboard (#2119): a Canvas-style course grid with Needs
 * attention and At a glance in a slim side column. Fully props-driven; the
 * per-role numbers come from `qmDashboardModel` via `DashboardPage`.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageHeading, Skeleton } from "@eduai/ui";
import type { Course } from "@/types/question";
import {
  QmCourseGridCard,
  QmCourseListHeader,
  QmCourseListRow,
  QmCourseViewToggle,
  useQmCourseView,
  type QmCourseLink,
  type QmCourseView,
} from "@/components/courses/QmCourseCard";
import type { QmAttentionRow, QmDashboardSection } from "./qmDashboardModel";

export type QmGlanceCell = { label: string; value: ReactNode; detail?: string };

export type QmDashboardViewProps = {
  heading: string;
  subheading: string;
  sections: QmDashboardSection[];
  courseTotal: number;
  coursesLoading: boolean;
  sideLoading: boolean;
  attentionRows: QmAttentionRow[];
  stats: QmGlanceCell[];
  linksFor: (course: Course) => QmCourseLink[];
};

const GRID = "grid grid-cols-1 gap-3 @md/dashboard:grid-cols-2 @3xl/dashboard:grid-cols-3";

function SkeletonCard() {
  return (
    <div
      data-testid="course-skeleton"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-xs"
    >
      <Skeleton className="h-[78px] rounded-none" />
      <div className="space-y-2 px-4 pt-3 pb-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="mx-2 mb-2 h-6 w-1/3" />
    </div>
  );
}

function CourseSection({
  section,
  view,
  linksFor,
}: {
  section: QmDashboardSection;
  view: QmCourseView;
  linksFor: (course: Course) => QmCourseLink[];
}) {
  if (view === "list") {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <QmCourseListHeader />
        {section.courses.map((c) => (
          <QmCourseListRow key={c.id} course={c} />
        ))}
      </div>
    );
  }
  return (
    <div className={GRID}>
      {section.courses.map((c) => (
        <QmCourseGridCard key={c.id} course={c} links={linksFor(c)} />
      ))}
    </div>
  );
}

function AttentionPanel({ rows, loading }: { rows: QmAttentionRow[]; loading: boolean }) {
  return (
    <section data-tour="dashboard-needs-attention" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
        <Link to="/library?status=draft" className="text-xs font-semibold text-primary-text">
          All drafts ›
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2 py-2" data-testid="attention-skeleton">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Nothing needs attention right now.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-2 py-2">
              <span
                aria-hidden="true"
                className="w-[3px] self-stretch rounded-full"
                style={{ background: row.edgeColor }}
              />
              <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">
                {row.text}
              </span>
              <Link
                to={row.href}
                aria-label={`${row.actionLabel}: ${row.text}`}
                className="shrink-0 text-xs font-semibold text-primary-text"
              >
                {row.actionLabel} ›
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GlancePanel({ stats, loading }: { stats: QmGlanceCell[]; loading: boolean }) {
  const lastRowStart = stats.length - (stats.length % 2 === 0 ? 2 : 1);
  return (
    <section data-tour="dashboard-stats" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">At a glance</h2>
      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`p-3 odd:border-r border-border ${i < lastRowStart ? "border-b" : ""}`}
          >
            <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
            <dd className="text-base font-semibold tabular-nums">
              {loading ? <Skeleton className="h-5 w-10" /> : s.value}
              {!loading && s.detail && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">{s.detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function QmDashboardView({
  heading,
  subheading,
  sections,
  courseTotal,
  coursesLoading,
  sideLoading,
  attentionRows,
  stats,
  linksFor,
}: QmDashboardViewProps) {
  const [view, setView] = useQmCourseView();
  const shown = sections.reduce((n, s) => n + s.courses.length, 0);
  const visible = sections.filter((s) => s.courses.length > 0);
  const empty = !coursesLoading && shown === 0;

  return (
    <div className="@container/dashboard flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading
        heading={heading}
        subheading={subheading}
        headingClassName="text-[28px] font-bold tracking-tight"
      />
      <div className="grid gap-8 @4xl/dashboard:grid-cols-[minmax(0,1fr)_260px]">
        <div data-tour="dashboard-courses" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">Courses</h2>
            <QmCourseViewToggle view={view} onChange={setView} />
          </div>
          {coursesLoading ? (
            <div className={GRID}>
              {[0, 1, 2].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : empty ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              <p>
                You don't have any courses yet. Courses come from EduAI Core and appear here once
                you teach one.
              </p>
              <Link
                to="/courses"
                className="mt-2 inline-block text-xs font-semibold text-primary-text"
              >
                Go to Courses ›
              </Link>
            </div>
          ) : (
            <>
              {visible.map((section) => (
                <div key={section.key} className="flex flex-col gap-2">
                  {section.title && (
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {section.title} ({section.courses.length})
                    </h3>
                  )}
                  <CourseSection section={section} view={view} linksFor={linksFor} />
                </div>
              ))}
              {courseTotal > shown && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground" data-testid="truncated-list-notice">
                    Showing {shown} of {courseTotal} courses
                  </p>
                  <Link to="/courses" className="text-xs font-semibold text-primary-text">
                    All {courseTotal} courses ›
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
        <aside aria-label="Activity" className="flex flex-col gap-6">
          <AttentionPanel rows={attentionRows} loading={sideLoading} />
          <GlancePanel stats={stats} loading={sideLoading} />
        </aside>
      </div>
    </div>
  );
}
