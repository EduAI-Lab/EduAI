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
 *
 * Both fetchers degrade gracefully: a thrown/network error is caught and
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
import { fetchCoreCourseSafe, listEduAiCourses } from './eduaiClient.js';

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
 * Live publish gate (#819): Core's `isPublished` wins whenever the offering
 * resolved against the batch; otherwise falls back to the local anchor's
 * last-known column so a Core outage degrades to stale-but-present rather
 * than hiding every course.
 */
export function resolveIsPublished(offering, coreCoursesById) {
  const core = coreCoursesById?.get(offering.coreOfferingId);
  return typeof core?.isPublished === 'boolean' ? core.isPublished : offering.isPublished;
}
