/**
 * @file "Continue learning" resume panel — the dashboard's right column for
 * learner roles (STUDENT, and TA when they're also enrolled as a student
 * somewhere). Replaces the old `/student` `ResumeCourseCard` (moved here as
 * part of the dashboard redesign, #938). Entirely driven by real per-course
 * `progress` data from `api.listCourses()` — no fabricated numbers.
 */
import { useNavigate } from 'react-router';
import { IconBooks, IconArrowRight } from '@tabler/icons-react';
import { Card, CardContent, courseHeroBackgroundStyle } from '@eduai/ui';
import type { Course } from '~/lib/types';
import { accentForCourse, courseCode, courseName } from '~/lib/course-display';
import { TruncatedListNotice } from '~/components/common/TruncatedListNotice';
import { findResumeCourse, inProgressCourses } from './dashboard-helpers';

type ContinueLearningPanelProps = {
  courses: Course[];
  /** Base path for course drilldown links, e.g. "/student" or "/instructor". */
  coursesBaseHref: string;
  /**
   * Full course count (#1208). `courses` is one bounded page, so when more exist
   * the panel says so instead of implying this is everything.
   */
  total?: number;
};

export function ContinueLearningPanel({
  courses,
  coursesBaseHref,
  total,
}: ContinueLearningPanelProps) {
  const navigate = useNavigate();
  const resumeCourse = findResumeCourse(courses);
  const others = inProgressCourses(courses).filter((c) => c.id !== resumeCourse?.id);

  if (!resumeCourse || !resumeCourse.progress) {
    // The notice belongs here too: "nothing in progress" is only true of the
    // courses on this page, and without it a learner with more courses than the
    // page size reads an empty panel as a statement about all of them.
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconBooks size={20} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Nothing in progress</p>
              <p className="text-xs text-muted-foreground">
                Start an activity in one of your courses to pick up here next time.
              </p>
            </div>
          </CardContent>
        </Card>
        <TruncatedListNotice
          shown={courses.length}
          total={total ?? courses.length}
          action="search your courses to find the rest"
        />
      </div>
    );
  }

  const progress = resumeCourse.progress;
  const accent = accentForCourse(resumeCourse);
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  // Darkened accent for the CTA label so text-on-white clears AA contrast
  // (raw palette accent is ~3:1, too light for body text).
  const ctaTextColor = `color-mix(in oklch, ${accent} 72%, black)`;

  return (
    <div className="flex flex-col gap-3">
      {/* Solid accent-fill hero — mirrors the CourseHeroCard/ModuleHero idiom so
          the resume card reads as the primary "pick this up" surface. */}
      <button
        type="button"
        onClick={() => navigate(`${coursesBaseHref}/courses/${resumeCourse.id}`)}
        style={courseHeroBackgroundStyle(accent)}
        className="group relative w-full cursor-pointer overflow-hidden rounded-[var(--radius-xl)] p-5 text-left text-white shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">
                {courseCode(resumeCourse)}
              </div>
              <h3 className="text-lg font-semibold leading-snug text-white">{courseName(resumeCourse)}</h3>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-inset ring-white/20">
              <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
              In progress
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/80">Your progress</span>
              <span className="font-semibold text-white">
                {progress.completed} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <span
            style={{ color: ctaTextColor }}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition-transform group-hover:scale-[1.01]"
          >
            Continue learning
            <IconArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>

      {others.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {others.slice(0, 3).map((course) => {
              const otherAccent = accentForCourse(course);
              const otherPct = Math.round(course.progress!.percentage);
              return (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => navigate(`${coursesBaseHref}/courses/${course.id}`)}
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                >
                  <span
                    className="h-9 w-1 flex-shrink-0 rounded-full"
                    style={{ background: otherAccent }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {courseCode(course)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{course.title}</div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${otherPct}%`, background: otherAccent }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                      {otherPct}%
                    </span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      <TruncatedListNotice
        shown={courses.length}
        total={total ?? courses.length}
        action="search your courses to find the rest"
      />
    </div>
  );
}
