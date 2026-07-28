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
 * Design — the unified extension course-fetch contract (shared verbatim with
 * Question Maker's courseListService):
 *   - Course FIELD truth comes ONLY from service-key fetches.
 *     `resolveCoreCourseCatalog` — ONE batched service-key full-catalog
 *     `GET /api/courses` call per list request (`listEduAiCoursesServiceKey`).
 *     Field values, existence, and publish state must never depend on the
 *     caller's own Core enrollment: AT and Core enrollment are independent
 *     tracks, so the cookie-scoped list silently omits courses the caller
 *     isn't Core-enrolled in and is therefore NOT a valid field source.
 *     Callers join the catalog against local anchor rows by `coreOfferingId`
 *     via `indexCoreCoursesById`, in memory — never a per-course Core call.
 *   - Caller AUTHORIZATION context comes from the cookie-scoped list only.
 *     `resolveCoreCourseList` (`listEduAiCourses`, cookie) survives solely
 *     for consumers of `callerEnrollmentRole` — today the auto-import
 *     mirrors (`importTaughtCoursesFromCore` / `importEnrolledCoursesFromCore`).
 *     It is never a source of field values.
 *   - `resolveCoreCourseById` — single detail fetch (service key,
 *     `GET /api/courses/:id`) for the one-course read seam (course detail
 *     page, publish/unpublish responses, etc). Safe to call unconditionally:
 *     returns `{ course: null, coreUnavailable: false }` when there's no
 *     `coreOfferingId` to resolve (nothing to fetch, not a failure).
 *   - `resolveIsPublished` — the #819 read-through gate, keyed off the
 *     catalog map: Core's live `isPublished` wins when resolved; unresolved
 *     fails closed (never a hard failure).
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
 * Fetch Core's FULL course catalog in one batched service-key call — the
 * single field-truth source for list flows (see file header). Contains every
 * non-deleted Core course regardless of the caller's enrollment, so an
 * AT-only-enrolled student's course resolves here by construction.
 * Returns `{ courses: [], coreUnavailable: true }` on any failure (network,
 * 5xx, missing service key, malformed response) so callers can render an
 * empty-but-not-broken list instead of a hard error; publish gates keyed off
 * the empty map then fail closed.
 */
export async function resolveCoreCourseCatalog() {
  try {
    // #1041: Core's `/courses` requires paging, so "the whole catalog" is now an
    // explicit page-walk rather than one unbounded read. This flow genuinely
    // needs every course — `/admin/courses` materializes a local anchor per Core
    // course, and the UNIT_ADMIN department scope filters the catalog by unit —
    // so there is no id set to narrow it with. Callers that already know which
    // ids they want should use `resolveCoreCoursesByIds` instead.
    const courses = await listEduAiCoursesServiceKey({ all: true });
    return { courses: Array.isArray(courses) ? courses : [], coreUnavailable: false };
  } catch (err) {
    console.error('[courseResolver] Core course catalog unavailable', err);
    return { courses: [], coreUnavailable: true };
  }
}

/**
 * Fetch the Core courses visible to the CALLER in one batched cookie-scoped
 * call. Authorization context only — this is the sole source of
 * `callerEnrollmentRole` (consumed by the auto-import mirrors) and must
 * never be used for field values, existence, or publish state (the catalog
 * above is the field source; see file header).
 */
export async function resolveCoreCourseList({ cookie } = {}) {
  try {
    // Authorization context for the caller's own courses; page-walked (#1041).
    const courses = await listEduAiCourses({ cookie, all: true });
    return { courses: Array.isArray(courses) ? courses : [], coreUnavailable: false };
  } catch (err) {
    console.error('[courseResolver] Core course list unavailable', err);
    return { courses: [], coreUnavailable: true };
  }
}

/**
 * Resolve a known set of Core courses by id in one unpaged lookup (#1125).
 *
 * Prefer this over `resolveCoreCourseCatalog` whenever the caller already holds
 * the `coreOfferingId`s it wants to join against — it is one request instead of
 * a page-walk of the whole catalog.
 */
export async function resolveCoreCoursesByIds(ids) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  if (wanted.length === 0) return { courses: [], coreUnavailable: false };
  try {
    const courses = await listEduAiCoursesServiceKey({ ids: wanted });
    return { courses: Array.isArray(courses) ? courses : [], coreUnavailable: false };
  } catch (err) {
    console.error('[courseResolver] Core course lookup unavailable', err);
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
