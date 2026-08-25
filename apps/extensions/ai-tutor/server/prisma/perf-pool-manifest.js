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
 * Ownership marker stamped into every manifest this seed writes. `previousCourseId`
 * only nominates a manifest for cleanup when it proves the manifest was generated
 * and owned by this perf-pool seed, so a corrupted or unrelated JSON file can never
 * name a real `CourseOffering` for deletion.
 */
export const PERF_POOL_MANIFEST_KIND = "ai-tutor-perf-pool";

const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isTimestamp = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isIdArray = (value) =>
  Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry > 0);
const isNonEmptyIdArray = (value) => isIdArray(value) && value.length > 0;
const isStringArray = (value) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);

/**
 * A manifest written by the CURRENT seed: the explicit ownership marker plus the
 * complete generated-pool shape. The marker is what authorizes deletion; the
 * remaining checks reject a partially-written or tampered manifest that happens to
 * carry the marker string.
 */
function isCurrentManifest(manifest) {
  return (
    manifest.manifestKind === PERF_POOL_MANIFEST_KIND &&
    isPositiveInt(manifest.courseId) &&
    isPositiveInt(manifest.topicId) &&
    isTimestamp(manifest.generatedAt) &&
    isPositiveInt(manifest.poolSize) &&
    isNonEmptyString(manifest.instructorUserId) &&
    isNonEmptyString(manifest.studentUserId) &&
    isNonEmptyIdArray(manifest.poolModulesReuse) &&
    isIdArray(manifest.poolModulesDrop) &&
    isNonEmptyIdArray(manifest.poolLessonsReuse) &&
    isIdArray(manifest.poolLessonsDrop) &&
    isNonEmptyIdArray(manifest.poolActivitiesReuse) &&
    isIdArray(manifest.poolActivitiesDrop) &&
    isPositiveInt(manifest.seededModuleId) &&
    isPositiveInt(manifest.seededLessonId) &&
    isPositiveInt(manifest.seededActivityId) &&
    isNonEmptyString(manifest.seededChatId)
  );
}

/**
 * A manifest written by the pre-#1072 seed, which recorded `nativeCourseId` and the
 * synthetic enrollment pools and predates the ownership marker. Cleanup of these is
 * retained, but only when the shape is complete and specific to what that seed
 * actually wrote — an unrelated file that merely happens to contain a course id (or
 * a legacy `nativeCourseId`) is never enough.
 */
function isLegacyManifest(manifest) {
  return (
    isPositiveInt(manifest.nativeCourseId) &&
    isPositiveInt(manifest.nativeTopicId) &&
    isTimestamp(manifest.generatedAt) &&
    isPositiveInt(manifest.poolSize) &&
    isNonEmptyString(manifest.instructorUserId) &&
    isNonEmptyString(manifest.studentUserId) &&
    isNonEmptyIdArray(manifest.poolModulesReuse) &&
    isIdArray(manifest.poolModulesDrop) &&
    isNonEmptyIdArray(manifest.poolLessonsReuse) &&
    isIdArray(manifest.poolLessonsDrop) &&
    isNonEmptyIdArray(manifest.poolActivitiesReuse) &&
    isIdArray(manifest.poolActivitiesDrop) &&
    isStringArray(manifest.enrollDropUserIds) &&
    isStringArray(manifest.enrollRoleUserIds) &&
    isPositiveInt(manifest.seededModuleId) &&
    isPositiveInt(manifest.seededLessonId) &&
    isPositiveInt(manifest.seededActivityId) &&
    isNonEmptyString(manifest.seededChatId)
  );
}

/**
 * Return the local `CourseOffering.id` recorded by a previous pool manifest, or
 * `null` when the manifest does not safely identify a prior pool.
 *
 * Deletion is authorized only when the manifest proves it was generated and owned
 * by this perf-pool seed: the current format requires the explicit
 * `PERF_POOL_MANIFEST_KIND` marker plus a complete generated-pool shape, and the
 * legacy pre-#1072 format requires its own complete, distinctive shape. Anything
 * else — a non-object, a missing/negative/non-integer id, an empty or partial pool,
 * a wrong ownership marker, or unrelated JSON — returns `null`, so callers never
 * delete a real course on the strength of a corrupted or unexpected file.
 */
export function previousCourseId(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  if (isCurrentManifest(manifest)) return manifest.courseId;
  if (isLegacyManifest(manifest)) return manifest.nativeCourseId;
  return null;
}
