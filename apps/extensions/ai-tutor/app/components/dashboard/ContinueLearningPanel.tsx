/**
 * @file "Continue learning" resume panel — the dashboard's right column for
 * learner roles (STUDENT, and TA when they're also enrolled as a student
 * somewhere). Replaces the old `/student` `ResumeCourseCard` (moved here as
 * part of the dashboard redesign, #938). Entirely driven by real per-course
 * `progress` data from `api.listCourses()` — no fabricated numbers.
 */
import { useNavigate } from 'react-router';
import { IconBooks } from '@tabler/icons-react';
import { Badge, Button, Card, CardContent, MeterBar } from '@eduai/ui';
import type { Course } from '~/lib/types';
import { courseCode } from '~/lib/course-display';
import { findResumeCourse, inProgressCourses } from './dashboard-helpers';

type ContinueLearningPanelProps = {
  courses: Course[];
  /** Base path for course drilldown links, e.g. "/student" or "/instructor". */
  coursesBaseHref: string;
};

export function ContinueLearningPanel({ courses, coursesBaseHref }: ContinueLearningPanelProps) {
  const navigate = useNavigate();
  const resumeCourse = findResumeCourse(courses);
  const others = inProgressCourses(courses).filter((c) => c.id !== resumeCourse?.id);

  if (!resumeCourse || !resumeCourse.progress) {
    return (
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
    );
  }

  const progress = resumeCourse.progress;

  return (
    <div className="flex flex-col gap-3">
      <Card
        style={{
          background: 'linear-gradient(to bottom, oklch(from var(--primary) l c h / 0.05), var(--card))',
        }}
      >
        <CardContent className="flex flex-col gap-3">
          <Badge variant="secondary" size="sm">
            In progress
          </Badge>
          <h3 className="text-base font-semibold leading-snug text-foreground">
            {resumeCourse.title}
          </h3>
          <MeterBar label="Your progress" value={progress.completed} total={progress.total} showCount />
          <Button
            type="button"
            variant="primary"
            className="mt-1 w-full"
            onClick={() => navigate(`${coursesBaseHref}/courses/${resumeCourse.id}`)}
          >
            Continue learning
          </Button>
        </CardContent>
      </Card>

      {others.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
          {others.slice(0, 3).map((course) => (
            <button
              key={course.id}
              type="button"
              onClick={() => navigate(`${coursesBaseHref}/courses/${course.id}`)}
              className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {courseCode(course)}
                </div>
                <div className="truncate text-xs text-muted-foreground">{course.title}</div>
              </div>
              <span className="flex-shrink-0 text-xs font-medium text-muted-foreground">
                {Math.round(course.progress!.percentage)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
