/**
 * @file "Needs attention" panel — the dashboard's right column for teaching
 * roles (INSTRUCTOR, UNIT_ADMIN) that manage publish state. Lists unpublished
 * courses so a draft that's ready never gets forgotten. Derived entirely from
 * the real `isPublished` flag on `api.listCourses()` results — no fabrication.
 */
import { Link } from 'react-router';
import { IconCircleCheck } from '@tabler/icons-react';
import { Card, CardContent } from '@eduai/ui';
import type { Course } from '~/lib/types';
import { courseCode } from '~/lib/course-display';

type NeedsAttentionPanelProps = {
  courses: Course[];
  /** Base path for course drilldown links, e.g. "/instructor". */
  coursesBaseHref: string;
};

export function NeedsAttentionPanel({ courses, coursesBaseHref }: NeedsAttentionPanelProps) {
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

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
      {drafts.slice(0, 5).map((course) => (
        <Link
          key={course.id}
          to={`${coursesBaseHref}/courses/${course.id}`}
          className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{courseCode(course)}</div>
            <div className="truncate text-xs text-muted-foreground">{course.title}</div>
          </div>
          <span className="flex-shrink-0 text-xs font-medium text-primary-text">Publish it →</span>
        </Link>
      ))}
    </div>
  );
}
