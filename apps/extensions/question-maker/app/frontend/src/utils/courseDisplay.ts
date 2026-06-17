/**
 * Helpers for course lists: scope visible courses to Core enrollments when present,
 * always retain user-created sandbox courses, otherwise show local seed courses with a mock label.
 */
import { Course } from '../types/question';
import { EduAICourseOption } from '../services/eduaiService';

export const SANDBOX_COURSE_CODE = 'SANDBOX';

export function normalizeCourseCode(value: string | null | undefined): string {
  return value ? value.replace(/\s+/g, '').toLowerCase() : '';
}

/** User-created practice/sandbox courses — not seeded catalog rows from Core sync. */
export function isSandboxCourse(course: Course): boolean {
  const code = normalizeCourseCode(course.code);
  const name = (course.name ?? '').toLowerCase();
  return (
    code === normalizeCourseCode(SANDBOX_COURSE_CODE) ||
    code === 'test' ||
    code.startsWith('test-') ||
    name.includes('sandbox') ||
    name.includes('test course')
  );
}

export function filterCoursesForCourseSelection(
  localCourses: Course[] | undefined,
  coreCourses: EduAICourseOption[]
): { courses: Course[]; showMockLabel: boolean } {
  const local = localCourses ?? [];
  if (coreCourses.length === 0) {
    return { courses: local, showMockLabel: true };
  }

  const coreIds = new Set(coreCourses.map((course) => course.id));
  const coreCodes = new Set(
    coreCourses
      .map((course) => normalizeCourseCode(course.code))
      .filter((code) => code !== '')
  );

  const courses = local.filter((course) => {
    if (isSandboxCourse(course)) {
      return true;
    }
    if (course.coreCourseId && coreIds.has(course.coreCourseId)) {
      return true;
    }
    const code = normalizeCourseCode(course.code);
    return code !== '' && coreCodes.has(code);
  });

  return { courses, showMockLabel: false };
}
