import {
  defaultColorIndexForCourse,
  groupCoursesByTerm as groupByTerm,
  paletteColorAtIndex,
  type CourseAccentColor,
  type CourseTermGroup,
  type TermInfo,
} from '@eduai/ui';
import type { Course } from './types';

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
 * Short course code for the card/hero. Prefers the EduAI-synced `code`; when a
 * course has none, derives a short token from the title so the hero's
 * "CODE: Name" layout never renders a bare ": Name".
 */
export function courseCode(course: Pick<Course, 'title' | 'externalMetadata'>): string {
  const code = course.externalMetadata?.code?.trim();
  if (code) return code;
  const firstWord = course.title.trim().split(/\s+/)[0] ?? '';
  return firstWord ? firstWord.slice(0, 10).toUpperCase() : 'COURSE';
}

/** Raw term value from EduAI metadata (empty string when unknown). */
export function courseTerm(course: Pick<Course, 'externalMetadata'>): string {
  return course.externalMetadata?.term?.trim() ?? '';
}

/** Year from EduAI metadata (null when unknown). */
export function courseYear(course: Pick<Course, 'externalMetadata'>): number | null {
  return course.externalMetadata?.year ?? null;
}

/** Adapt a Course to the shared `TermInfo` shape; startDate is authoritative for ordering. */
function courseTermInfo(course: Pick<Course, 'externalMetadata' | 'startDate'>): TermInfo {
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
export function groupCoursesByTerm<T extends Pick<Course, 'externalMetadata' | 'startDate'>>(
  courses: T[],
): CourseTermGroup<T>[] {
  return groupByTerm(courses, courseTermInfo);
}
