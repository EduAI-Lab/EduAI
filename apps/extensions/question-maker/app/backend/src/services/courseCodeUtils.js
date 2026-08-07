/** Normalizes course codes for case- and whitespace-insensitive comparison (display/RBAC lookups only). */
export function normalizeCourseCode(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * Keep one row per Core-course identity (#1072 §4 step 6). `coreCourseId` is
 * DB-unique across all rows once set, so this only ever collapses duplicate
 * *unlinked* local rows that happen to share the same `id` — i.e. never,
 * except defensively. Unlinked rows (`coreCourseId` null) have no shared
 * identity, so each keeps its own row rather than being merged by `code`.
 */
export function dedupeCoursesByCoreId(courses) {
  const byKey = new Map();

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
