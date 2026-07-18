/**
 * Helpers for course lists: scope visible courses to Core enrollments when present,
 * otherwise show local seed courses with a mock label. Local-only "sandbox" course
 * creation is retired (#1072 §4 step 7) — every course originates in Core.
 */
import { termLabel } from '@eduai/ui';
import { Course } from '../types/question';
import { EduAICourseOption } from '../services/eduaiService';

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

/**
 * Keep one row per Core-course identity (#1072 §4 step 6). `coreCourseId` is
 * DB-unique across all rows once set, so this only ever collapses duplicate
 * *unlinked* local rows that happen to share the same `id` — i.e. never,
 * except defensively. Unlinked rows (`coreCourseId` null) have no shared
 * identity, so each keeps its own row rather than being merged by `code`.
 */
export function dedupeCoursesByCoreId(courses: Course[]): Course[] {
  const byKey = new Map<string, Course>();

  for (const course of courses) {
    const key = course.coreCourseId ? `core:${course.coreCourseId}` : `local:${course.id}`;
    const existing = byKey.get(key);
    const prefer = !existing || course.id > existing.id ? course : existing;
    byKey.set(key, prefer);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
  );
}

/**
 * Scopes the local course list to the caller's Core enrollments (identity is
 * `coreCourseId` — #1072 §4 step 6, no code-matching fallback). ADMIN bypasses
 * the filter (sees everything); other roles only see local rows that are
 * either linked to a course the caller is enrolled in, or not yet linked at
 * all (pre-#1072-step-7 local-only rows with no Core identity to check).
 */
export function filterCoursesForCourseSelection(
  localCourses: Course[] | undefined,
  coreCourses: EduAICourseOption[],
  options?: { bypassCoreEnrollmentFilter?: boolean }
): { courses: Course[]; showMockLabel: boolean } {
  const local = dedupeCoursesByCoreId(localCourses ?? []);
  if (options?.bypassCoreEnrollmentFilter || coreCourses.length === 0) {
    return { courses: local, showMockLabel: coreCourses.length === 0 };
  }

  const coreIds = new Set(coreCourses.map((course) => course.id));

  const courses = local.filter(
    (course) => !course.coreCourseId || coreIds.has(course.coreCourseId),
  );

  return { courses, showMockLabel: false };
}
