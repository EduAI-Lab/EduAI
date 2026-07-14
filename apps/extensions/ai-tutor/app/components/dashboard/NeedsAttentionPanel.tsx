/**
 * @file "Needs attention" panel — the dashboard's right column for teaching
 * roles (INSTRUCTOR, UNIT_ADMIN) that manage publish state. Surfaces the draft
 * courses that still need publishing so a ready-to-go course never gets
 * forgotten. Mirrors the learner `ContinueLearningPanel` idiom: a solid
 * accent-fill hero for the top draft plus a compact accent-railed list for the
 * rest. Derived entirely from the real `isPublished` flag on
 * `api.listCourses()` results — no fabrication.
 */
import { useNavigate } from 'react-router';
import { IconCircleCheck, IconArrowRight, IconEyeOff } from '@tabler/icons-react';
import { Card, CardContent, courseHeroBackgroundStyle } from '@eduai/ui';
import type { Course } from '~/lib/types';
import { accentForCourse, courseCode, courseName } from '~/lib/course-display';

type NeedsAttentionPanelProps = {
  courses: Course[];
  /** Base path for course drilldown links, e.g. "/instructor". */
  coursesBaseHref: string;
};

export function NeedsAttentionPanel({ courses, coursesBaseHref }: NeedsAttentionPanelProps) {
  const navigate = useNavigate();
  const drafts = courses.filter((c) => !c.isPublished);

  if (drafts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconCircleCheck size={20} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground">Every course you can see is published.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const [primary, ...others] = drafts;
  const accent = accentForCourse(primary);
  // Darkened accent for the CTA label so text-on-white clears AA contrast.
  const ctaTextColor = `color-mix(in oklch, ${accent} 72%, black)`;

  return (
    <div className="flex flex-col gap-3">
      {/* Solid accent-fill hero — the primary draft to publish, mirroring the
          CourseHeroCard/ContinueLearning idiom so it reads as the top action. */}
      <button
        type="button"
        onClick={() => navigate(`${coursesBaseHref}/courses/${primary.id}`)}
        style={courseHeroBackgroundStyle(accent)}
        className="group relative w-full cursor-pointer overflow-hidden rounded-[var(--radius-xl)] p-5 text-left text-white shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">
                {courseCode(primary)}
              </div>
              <h3 className="text-lg font-semibold leading-snug text-white">{courseName(primary)}</h3>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-inset ring-white/20">
              <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
              Draft
            </span>
          </div>

          <p className="inline-flex items-center gap-1.5 text-sm text-white/80">
            <IconEyeOff size={15} aria-hidden="true" />
            Not visible to students yet
          </p>

          <span
            style={{ color: ctaTextColor }}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition-transform group-hover:scale-[1.01]"
          >
            Publish it
            <IconArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>

      {others.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {others.slice(0, 4).map((course) => {
              const otherAccent = accentForCourse(course);
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
                    <div className="truncate text-sm font-medium text-foreground">{courseCode(course)}</div>
                    <div className="truncate text-xs text-muted-foreground">{course.title}</div>
                  </div>
                  <span className="flex-shrink-0 text-xs font-medium text-primary-text">Publish it →</span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
