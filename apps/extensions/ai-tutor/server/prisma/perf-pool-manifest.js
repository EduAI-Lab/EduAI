/**
 * Pure manifest helpers for the AI Tutor perf-pool seed (`prisma/seed-perf.ts`).
 *
 * Kept dependency-free so the cleanup-selection rules can be unit-tested without
 * importing the Prisma client or running the seed. The seed writes
 * `<repoRoot>/.perf-pool/aitutor.json` and re-reads it on the next run to find and
 * remove the previous pool; `previousCourseId` validates that manifest before
 * anything is deleted.
 */

/**
 * Return the local `CourseOffering.id` recorded by a previous pool manifest, or
 * `null` when the manifest does not safely identify a prior pool.
 *
 * Accepts the current `courseId` field and the legacy `nativeCourseId` field so a
 * manifest written by an older seed (before the #1072 pure-anchor rename) can
 * still be cleaned up. Anything malformed — a non-object, a missing/negative/
 * non-integer id, or a manifest that lacks a second recognizable pool field —
 * returns `null`, so callers never delete a real course on the strength of a
 * corrupted or unexpected file.
 */
export function previousCourseId(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  const id = manifest.courseId ?? manifest.nativeCourseId;
  if (!Number.isInteger(id) || id <= 0) return null;
  const hasPoolShape =
    Number.isInteger(manifest.seededModuleId) || Array.isArray(manifest.poolModulesReuse);
  return hasPoolShape ? id : null;
}
