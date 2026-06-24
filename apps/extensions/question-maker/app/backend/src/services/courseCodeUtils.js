/** Normalizes course codes for case- and whitespace-insensitive comparison. */
export function normalizeCourseCode(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toLowerCase();
}

/** Keep one row per normalized course code; prefer Core-linked, then newest id. */
export function dedupeCoursesByCode(courses) {
  const byCode = new Map();

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
