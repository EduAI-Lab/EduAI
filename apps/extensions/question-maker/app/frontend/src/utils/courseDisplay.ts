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

/** Keep one row per normalized course code; prefer Core-linked, then newest id. */
export function dedupeCoursesByCode(courses: Course[]): Course[] {
  const byCode = new Map<string, Course>();

  for (const course of courses) {
    const key = normalizeCourseCode(course.code) || `id:${course.id}`;
    const existing = byCode.get(key);
    if (!existing) {
      byCode.set(key, course);
      continue;
    }
    const prefer =
      course.coreCourseId && !existing.coreCourseId
        ? course
        : !course.coreCourseId && existing.coreCourseId
          ? existing
          : course.id > existing.id
            ? course
            : existing;
    byCode.set(key, prefer);
  }

  return Array.from(byCode.values()).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
  );
}

export function filterCoursesForCourseSelection(
  localCourses: Course[] | undefined,
  coreCourses: EduAICourseOption[]
): { courses: Course[]; showMockLabel: boolean } {
  const local = dedupeCoursesByCode(localCourses ?? []);
  if (coreCourses.length === 0) {
    return { courses: local, showMockLabel: true };
  }

  const coreIds = new Set(coreCourses.map((course) => course.id));
  const coreCodes = new Set(
    coreCourses
      .map((course) => normalizeCourseCode(course.code))
      .filter((code) => code !== '')
  );

  const courses = dedupeCoursesByCode(
    local.filter((course) => {
      if (isSandboxCourse(course)) {
        return true;
      }
      if (course.coreCourseId && coreIds.has(course.coreCourseId)) {
        return true;
      }
      const code = normalizeCourseCode(course.code);
      return code !== '' && coreCodes.has(code);
    }),
  );

  return { courses, showMockLabel: false };
}
