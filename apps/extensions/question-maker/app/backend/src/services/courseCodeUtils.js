/** Normalizes course codes for case- and whitespace-insensitive comparison (display/RBAC lookups only). */
export function normalizeCourseCode(value) {
  if (!value || typeof value !== "string") return "";
  return value.replace(/\s+/g, "").toLowerCase();
}

/**
 * Build Core `?search=` candidates for course-code lookups (#1362).
 * Mirrors Core `courseCodeLookupCandidates`: compact client codes like
 * `COSC121` must also try `COSC 121` because Core's search is literal
 * `contains` (no whitespace folding).
 */
export function courseCodeLookupCandidates(courseCode) {
  if (!courseCode || typeof courseCode !== 'string') return [];
  const trimmed = courseCode.trim();
  if (!trimmed) return [];
  const compact = trimmed.replace(/\s+/g, '');
  const spaced = compact.replace(/([A-Za-z]+)(\d+)/, '$1 $2');
  return [...new Set([trimmed, compact, spaced].filter(Boolean))];
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
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}
