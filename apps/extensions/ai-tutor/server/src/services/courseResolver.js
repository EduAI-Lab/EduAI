/**
 * @file Core-course read-through resolver (#1072 step 2).
 *
 * Responsibility: the ONE seam that turns a `coreOfferingId` (detail) or a
 * request context (list) into resolved Core course data, built on top of
 * `eduaiClient`. Course fields — title/description/department/dates/
 * isPublished/term/year/aiInstructions — live in Core now; nothing in this
 * file reads or writes local `CourseOffering` columns, and nothing loops a
 * single-course fetch per row (locked N+1 decision, #1072 §1).
 *
 * Design:
 *   - `resolveCoreCourseList` — ONE batched `GET /api/courses` call (via
 *     `listEduAiCourses`, cookie-scoped so Core's own RBAC —
 *     `buildCourseListFilter`, including ADMIN's admin-to-all branch — does
 *     the scoping). Callers join the result against local anchor rows by
 *     `coreOfferingId` via `indexCoreCoursesById`, in memory — never a
 *     per-course Core call.
 *   - `resolveCoreCourseById` — single detail fetch (service key,
 *     `GET /api/courses/:id`) for the one-course read seam (course detail
 *     page, publish/unpublish responses, etc). Safe to call unconditionally:
 *     returns `{ course: null, coreUnavailable: false }` when there's no
 *     `coreOfferingId` to resolve (nothing to fetch, not a failure).
 *   - `resolveIsPublished` — the #819 read-through gate: Core's live
 *     `isPublished` wins when resolved, otherwise the local anchor's
 *     last-known value (never a hard failure).
 *   - `resolveMissingCoreCourses` — the #1082 independent-enrollment fallback.
 *     `resolveCoreCourseList`'s cookie-scoped batch only contains courses
 *     Core's own RBAC (`buildCourseListFilter`) says the caller can see,
 *     which for non-ADMIN/department scoping requires a matching Core
 *     enrollment. AT and Core enrollment are intentionally independent
 *     tracks, so a caller who is AT-enrolled but NOT Core-enrolled in a
 *     course is silently absent from that list — every `resolveIsPublished`/
 *     `mapCourseOffering` call keyed off it then treats the course as
 *     unpublished/unknown even when Core has it published. Given the
 *     `coreOfferingId`s the caller's local rows actually need, this fills
 *     just the gaps via ONE service-key full-catalog fetch
 *     (`listEduAiCoursesServiceKey`, never per-course), leaving the
 *     cookie-scoped entries (which carry `callerEnrollmentRole`) untouched.
 *
 * Both list/detail fetchers degrade gracefully: a thrown/network error is caught and
 * reported as `coreUnavailable: true` with empty/null data, never a hard
 * 500 — mirrors the ai-status.js "UNKNOWN" fail-soft pattern. Callers set an
 * `X-Core-Status: unavailable` response header on `coreUnavailable` so the
 * client can surface it (see `app/lib/api.ts`'s `http()`).
 *
 * Callers: `routes/courses.js` (list + detail + publish/unpublish +
 * dashboard-stats). Any future route that needs Core course data should
 * resolve through here rather than reading `CourseOffering` columns or the
 * `externalMetadata` snapshot directly.
 */
import { fetchCoreCourseSafe, listEduAiCourses, listEduAiCoursesServiceKey } from './eduaiClient.js';

/**
 * Fetch every Core course visible to the caller in one batched call.
 * Returns `{ courses: [], coreUnavailable: true }` on any failure (network,
 * 5xx, malformed response) so callers can render an empty-but-not-broken
 * list instead of a hard error.
 */
export async function resolveCoreCourseList({ cookie } = {}) {
  try {
    const courses = await listEduAiCourses({ cookie });
    return { courses: Array.isArray(courses) ? courses : [], coreUnavailable: false };
  } catch (err) {
    console.error('[courseResolver] Core course list unavailable', err);
    return { courses: [], coreUnavailable: true };
  }
}

/**
 * Index a resolved Core course list by id for O(1) lookup — the shape
 * `mapCourseOffering`'s second argument expects when joining a batch of
 * local anchor rows against one Core list fetch.
 */
export function indexCoreCoursesById(coreCourses) {
  const byId = new Map();
  for (const course of coreCourses ?? []) {
    if (course?.id) byId.set(course.id, course);
  }
  return byId;
}

/**
 * #1082: fills gaps in a cookie-scoped Core course index for the
 * `coreOfferingId`s a caller's LOCAL (AT) rows actually need resolved. Only
 * looks at ids that are (a) present in `coreOfferingIds` and (b) absent from
 * `coreCoursesById` — a caller who is AT-enrolled but not Core-enrolled in
 * that course is exactly this situation (see file header). Skips the extra
 * Core call entirely when there's nothing missing.
 *
 * Fetches the FULL catalog once via the service key
 * (`listEduAiCoursesServiceKey`) rather than looping a per-course fetch —
 * one network call regardless of how many ids are missing. The cookie-scoped
 * map stays primary: existing entries (which carry `callerEnrollmentRole`)
 * are never overwritten, and the input map is never mutated — a new Map is
 * returned (the original is returned unchanged when there's no gap to fill).
 *
 * Fails soft: a fallback fetch failure (Core down, no service key
 * configured, etc) leaves the misses unresolved — still absent from the
 * returned map — rather than throwing, so `resolveIsPublished` keeps failing
 * closed for them and `mapCourseOffering` keeps degrading their fields to
 * null, same posture as every other fetcher in this file.
 */
export async function resolveMissingCoreCourses(coreCoursesById, coreOfferingIds) {
  const missingIds = new Set(
    (coreOfferingIds ?? []).filter((id) => id && !coreCoursesById.has(id)),
  );
  if (missingIds.size === 0) return coreCoursesById;

  try {
    const catalog = await listEduAiCoursesServiceKey();
    const merged = new Map(coreCoursesById);
    for (const course of catalog ?? []) {
      if (course?.id && missingIds.has(course.id)) {
        merged.set(course.id, course);
      }
    }
    return merged;
  } catch (err) {
    console.error('[courseResolver] Service-key course catalog fallback failed', err);
    return coreCoursesById;
  }
}

/**
 * Fetch a single Core course by id (service key). Returns
 * `{ course: null, coreUnavailable: true }` on network/5xx failure, vs.
 * `{ course: null, coreUnavailable: false }` for a genuine 404 (or when
 * `coreOfferingId` is absent, e.g. a legacy unlinked offering) — so the
 * caller can tell "Core is down" from "nothing to resolve" and render a
 * placeholder instead of a hard error either way.
 */
export async function resolveCoreCourseById(coreOfferingId) {
  if (!coreOfferingId) return { course: null, coreUnavailable: false };
  try {
    const course = await fetchCoreCourseSafe(coreOfferingId);
    return { course, coreUnavailable: false };
  } catch (err) {
    console.error('[courseResolver] Core course fetch failed', coreOfferingId, err);
    return { course: null, coreUnavailable: true };
  }
}

/**
 * Live publish gate (#819): Core's `isPublished` is the sole source of truth
 * — `CourseOffering` has no local `isPublished` column anymore (#1072 step
 * 4). Unresolved (offering not in the batch, or Core unavailable) fails
 * closed to `false` rather than leaking an unpublished/unknown course to
 * students; a stale local mirror is no longer available as a middle ground.
 */
export function resolveIsPublished(offering, coreCoursesById) {
  const core = coreCoursesById?.get(offering.coreOfferingId);
  return typeof core?.isPublished === 'boolean' ? core.isPublished : false;
}

/**
 * Single-course counterpart to `resolveIsPublished` for route handlers that
 * only have one course row in hand (a nested `courseOffering` include, not a
 * pre-fetched Core list/batch) — e.g. the module/lesson publish gates and
 * the AI-tutoring endpoints. Self-resolves via `resolveCoreCourseById` and
 * fails closed to `false` on any Core outage, same posture as
 * `resolveIsPublished`.
 */
export async function isCoursePublishedLive(coreOfferingId) {
  const { course } = await resolveCoreCourseById(coreOfferingId);
  return typeof course?.isPublished === 'boolean' ? course.isPublished : false;
}
