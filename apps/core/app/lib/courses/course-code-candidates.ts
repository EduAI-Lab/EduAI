/**
 * Build lookup candidates for Core's exact-match `Course.code` column.
 *
 * Callers (e.g. Question Maker before `coreCourseId` pass-through) sometimes
 * send `"COSC121"` while Core stores `"COSC 121"`. Prefer an explicit `courseId`
 * when available; this is the belt-and-suspenders path for `courseCode` only.
 */
export function courseCodeLookupCandidates(courseCode: string): string[] {
  const trimmed = courseCode.trim();
  if (!trimmed) return [];
  const compact = trimmed.replace(/\s+/g, "");
  const spaced = compact.replace(/([A-Za-z]+)(\d+)/, "$1 $2");
  return [...new Set([trimmed, compact, spaced].filter(Boolean))];
}
