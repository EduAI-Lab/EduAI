import type { Course } from '~/lib/types';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '~/lib/course-display';
import type { DashboardCourseRow } from './DashboardView';

/** Time-of-day greeting — mirrors Core's dashboard hero (`apps/core/app/routes/dashboard.tsx`)
 *  and the pre-existing `/student` landing page so every AI Tutor + Core surface
 *  greets the user the same way. */
export function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only, handling the "Dr. First Last" edge case Core's greeting handles. */
export function firstNameOf(name: string | undefined): string | null {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return null;
  return parts.length === 3 && parts[0]!.endsWith('.') ? parts[1]! : parts[0]!;
}

/** Maps a `Course` to the compact row shape the dashboard course-list panel renders. */
export function toDashboardCourseRow(course: Course): DashboardCourseRow {
  return {
    id: course.id,
    code: courseCode(course),
    name: courseName(course),
    term: courseTerm(course),
    year: courseYear(course),
    accentColor: accentForCourse(course),
    progressLabel:
      course.progress && course.progress.total > 0
        ? `${Math.round(course.progress.percentage)}% complete`
        : null,
  };
}

/**
 * The most useful "pick this back up" candidate: the enrolled course with the
 * highest completion percentage that isn't finished yet. Course-level progress
 * (from `api.listCourses()`) has no last-viewed timestamp, so this is a
 * progress-based heuristic, not a recency one — mirrors the logic the old
 * `/student` `ResumeCourseCard` used before it moved to the dashboard.
 */
export function findResumeCourse(courses: Course[]): Course | null {
  const inProgress = courses.filter((course) => {
    const progress = course.progress;
    return Boolean(progress) && progress!.completed > 0 && progress!.completed < progress!.total;
  });
  if (inProgress.length === 0) return null;
  return [...inProgress].sort(
    (a, b) => (b.progress?.percentage ?? 0) - (a.progress?.percentage ?? 0),
  )[0]!;
}

/** All enrolled courses with progress that are neither unstarted nor finished. */
export function inProgressCourses(courses: Course[]): Course[] {
  return courses.filter((course) => {
    const progress = course.progress;
    return Boolean(progress) && progress!.completed > 0 && progress!.completed < progress!.total;
  });
}

/** Enrolled courses whose progress is complete. */
export function completedCourses(courses: Course[]): Course[] {
  return courses.filter((course) => {
    const progress = course.progress;
    return Boolean(progress) && progress!.total > 0 && progress!.completed >= progress!.total;
  });
}

/** Enrolled courses with progress data that haven't been started yet. */
export function notStartedCourses(courses: Course[]): Course[] {
  return courses.filter((course) => {
    const progress = course.progress;
    return Boolean(progress) && progress!.total > 0 && progress!.completed === 0;
  });
}

/** Sums `completed`/`total` across every course that carries progress data. */
export function aggregateProgress(courses: Course[]): { completed: number; total: number } {
  return courses.reduce(
    (acc, course) => {
      if (!course.progress) return acc;
      acc.completed += course.progress.completed;
      acc.total += course.progress.total;
      return acc;
    },
    { completed: 0, total: 0 },
  );
}

export function relativeTime(iso: string): string {
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
