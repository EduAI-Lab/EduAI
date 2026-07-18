import {
  defaultColorIndexForCourse,
  groupCoursesByTerm as groupByTerm,
  paletteColorAtIndex,
  type CourseAccentColor,
  type CourseTermGroup,
  type TermInfo,
} from '@eduai/ui';
import type { Course } from './types';
import { titleName } from './course-title';

/**
 * Course presentation helpers shared by the dashboard `CourseCard`s and the
 * course-detail `CourseHeroCard`, so a course keeps ONE visual identity (accent
 * colour + code) everywhere it appears — matching how Core/QM colour courses.
 */

/** Stable accent colour for a course, keyed off its id. */
export function accentForCourse(course: Pick<Course, 'id'>): CourseAccentColor {
  return paletteColorAtIndex(defaultColorIndexForCourse(String(course.id)));
}

/**
 * Short course code for the card colour band / hero eyebrow. Prefers the
 * Core-owned, read-through `code` (#1072 step 2); when a course has none,
 * derives a short token from the title so the eyebrow never renders empty.
 */
export function courseCode(course: Pick<Course, 'title' | 'code'>): string {
  const code = course.code?.trim();
  if (code) return code;
  const firstWord = course.title.trim().split(/\s+/)[0] ?? '';
  return firstWord ? firstWord.slice(0, 10).toUpperCase() : 'COURSE';
}

/**
 * Course name for the card/hero headline — the title with any leading course
 * code stripped ("COSC 101 - Computer Studies" → "Computer Studies"). The code
 * is shown separately (card colour band, hero eyebrow), so the headline needn't
 * repeat it behind a colon/dash. Falls back to the whole title when it carries
 * no code prefix.
 */
export function courseName(course: Pick<Course, 'title'>): string {
  return titleName(course.title);
}

/** Raw term value, read-through from Core (#1072 step 2; empty string when unknown). */
export function courseTerm(course: Pick<Course, 'term'>): string {
  return course.term?.trim() ?? '';
}

/** Year, read-through from Core (#1072 step 2; null when unknown). */
export function courseYear(course: Pick<Course, 'year'>): number | null {
  return course.year ?? null;
}

/** Adapt a Course to the shared `TermInfo` shape; startDate is authoritative for ordering. */
function courseTermInfo(course: Pick<Course, 'term' | 'year' | 'startDate'>): TermInfo {
  return {
    term: courseTerm(course),
    year: courseYear(course),
    startDate: course.startDate ?? null,
  };
}

export type { CourseTermGroup };

/**
 * Groups courses by canonical term, newest first, via the shared `@eduai/ui`
 * term model — so term labels/ordering read identically across Core, AI Tutor,
 * and Question Maker. Course-list pages render one heading-less grid for a
 * single group, or a `<section>` per term (heading = `group.labelLong`) when
 * there's more than one — see `student.tsx` / `instructor.tsx`.
 */
export function groupCoursesByTerm<T extends Pick<Course, 'term' | 'year' | 'startDate'>>(
  courses: T[],
): CourseTermGroup<T>[] {
  return groupByTerm(courses, courseTermInfo);
}
