/**
 * Shared loader-side access to `GET /api/courses/facets` (#1208).
 *
 * Two things the raw `api.listCourseFacets()` call got wrong at the call sites:
 *
 *   1. It sat inside `clientLoader` alongside `listCourses`, and React Router
 *      re-runs the loader on every URL change — which is every debounced
 *      keystroke, every filter click and every page step. Both handlers
 *      independently page-walk Core's whole catalog, so half that traffic was
 *      pure waste: the facets response doesn't vary with search/filter/page.
 *      Caching here restores the "fetched once per mount" contract the route
 *      docblocks claim, without a `shouldRevalidate` that would also (wrongly)
 *      suppress the list refetch the search depends on.
 *   2. It was awaited in the same `Promise.all` as the list, so a facets 500
 *      rejected the loader and replaced the entire Courses page with its error
 *      boundary — for a decorative dropdown, while the list itself was fine.
 *      Failure now degrades to no dropdowns.
 *
 * Related: routes/instructor.tsx, routes/student.tsx, server/src/routes/courses.js
 */
import api, { type CourseFacets } from './api';

/** Facets are per-caller and change rarely; a short TTL keeps a long-lived SPA
 *  session from pinning a stale set after an import or a publish. */
const FACETS_TTL_MS = 60_000;

export const EMPTY_COURSE_FACETS: CourseFacets = {
  terms: [],
  statuses: [],
  progress: [],
  coreUnavailable: false,
};

let cached: { at: number; value: Promise<CourseFacets> } | null = null;

/**
 * Fetch the caller's facets, reusing a recent result. Never rejects — callers
 * render filter dropdowns from it, and losing the dropdowns must not cost the
 * list. Failures and Core-unavailable responses are deliberately not cached, so
 * the next navigation retries rather than pinning a degraded set for the TTL.
 */
export function loadCourseFacets(): Promise<CourseFacets> {
  if (cached && Date.now() - cached.at < FACETS_TTL_MS) return cached.value;

  const value = api
    .listCourseFacets()
    .then((facets) => {
      if (facets?.coreUnavailable) cached = null;
      return facets ?? EMPTY_COURSE_FACETS;
    })
    .catch(() => {
      cached = null;
      return EMPTY_COURSE_FACETS;
    });

  cached = { at: Date.now(), value };
  return value;
}

/** Drop the cached facets — for tests, and after anything that changes the
 *  caller's accessible course set (an import, a publish). */
export function clearCourseFacetsCache(): void {
  cached = null;
}
