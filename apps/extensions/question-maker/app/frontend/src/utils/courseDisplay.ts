/**
 * Helpers for course lists: scope visible courses to Core enrollments when present,
 * always retain user-created sandbox courses, otherwise show local seed courses with a mock label.
 */
import { termLabel } from '@eduai/ui';
import { Course } from '../types/question';
import { EduAICourseOption } from '../services/eduaiService';

export const SANDBOX_COURSE_CODE = 'SANDBOX';

export function normalizeCourseCode(value: string | null | undefined): string {
  return value ? value.replace(/\s+/g, '').toLowerCase() : '';
}

/**
 * Canonical compact term label, e.g. "2026W1", via the shared `@eduai/ui` term
 * model — identical to AI Tutor and Core. Returns null when neither term nor
 * year is known, so nav labels can omit the "(…)" suffix entirely.
 */
export function formatCourseTermYear(
  course: Pick<Course, 'term' | 'year'>,
): string | null {
  const term = typeof course.term === 'string' ? course.term.trim() : '';
  const year = typeof course.year === 'number' && Number.isFinite(course.year) ? course.year : null;
  if (!term && year === null) return null;
  return termLabel(term, year);
}

export function formatCourseNavLabel(
  course: Pick<Course, 'code' | 'name' | 'term' | 'year'>,
): string {
  const base = `${course.code || '—'} - ${course.name}`;
  const termYear = formatCourseTermYear(course);
  return termYear ? `${base} (${termYear})` : base;
}

function resolveCoreCourseMetadata(
  course: Course,
  coreById: Map<string, EduAICourseOption>,
  coreByCode: Map<string, EduAICourseOption>,
): EduAICourseOption | null {
  if (course.coreCourseId && coreById.has(course.coreCourseId)) {
    return coreById.get(course.coreCourseId)!;
  }
  const code = normalizeCourseCode(course.code);
  if (code && coreByCode.has(code)) {
    return coreByCode.get(code)!;
  }
  return null;
}

/** Attach Core term/year to local courses matched by coreCourseId or normalized code. */
export function enrichCoursesWithCoreMetadata(
  localCourses: Course[],
  coreCourses: EduAICourseOption[],
): Course[] {
  const coreById = new Map(coreCourses.map((course) => [course.id, course]));
  const coreByCode = new Map(
    coreCourses
      .map((course) => [normalizeCourseCode(course.code), course] as const)
      .filter(([code]) => code !== ''),
  );

  return localCourses.map((course) => {
    const core = resolveCoreCourseMetadata(course, coreById, coreByCode);
    if (!core) return course;

    return {
      ...course,
      description: core.description ?? course.description ?? null,
      term: core.term ?? course.term ?? null,
      year: core.year ?? course.year ?? null,
    };
  });
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
  coreCourses: EduAICourseOption[],
  options?: { bypassCoreEnrollmentFilter?: boolean }
): { courses: Course[]; showMockLabel: boolean } {
  const local = dedupeCoursesByCode(localCourses ?? []);
  if (options?.bypassCoreEnrollmentFilter || coreCourses.length === 0) {
    return { courses: local, showMockLabel: coreCourses.length === 0 };
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
