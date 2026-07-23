/**
 * Build lookup candidates for Core's `Course.code` column.
 *
 * Callers (e.g. Question Maker before `coreCourseId` pass-through) sometimes
 * send `"COSC121"` while Core stores `"COSC 121"`. Prefer an explicit `courseId`
 * when available; this is the belt-and-suspenders path for `courseCode` only.
 *
 * Case is handled at the query layer (`mode: "insensitive"`); candidates keep
 * the caller's casing and only expand whitespace variants.
 */
export function courseCodeLookupCandidates(courseCode: string): string[] {
  const trimmed = courseCode.trim();
  if (!trimmed) return [];
  const compact = trimmed.replace(/\s+/g, "");
  const spaced = compact.replace(/([A-Za-z]+)(\d+)/, "$1 $2");
  return [...new Set([trimmed, compact, spaced].filter(Boolean))];
}

/**
 * Pick the first candidate that matches a row (case-insensitive), preserving
 * candidate priority (exact trimmed → compact → spaced).
 */
export function pickCourseIdByCandidatePriority<T extends { id: string; code: string }>(
  candidates: string[],
  rows: T[],
): string | null {
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase();
    const hit = rows.find((row) => row.code.toLowerCase() === needle);
    if (hit) return hit.id;
  }
  return null;
}
