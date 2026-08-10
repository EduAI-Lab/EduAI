/**
 * @file Catalog-side search/filter matching for the course list (#1208).
 *
 * Responsibility: Turn free-text search and the term/status filter selections
 *   into a Prisma `where` fragment, plus enumerate the facet values available to
 *   a caller. Pure functions over an already-fetched Core catalog — no I/O.
 * Callers: `GET /api/courses` and `GET /api/courses/facets`.
 * Gotchas:
 *   - AI Tutor's `CourseOffering` row holds only `id`/`coreOfferingId`/timestamps.
 *     Title, code, term, year and isPublished are ALL Core-owned and read through
 *     `mapCourseOffering` (#1072 step 4) — there is no local column to filter on.
 *     So every dimension here resolves against the catalog the request already
 *     fetched, reduces to a set of `coreOfferingId`s, and is pushed into SQL as
 *     `coreOfferingId IN (...)`. Same shape the publish gate already uses.
 *   - The catalog is EMPTY when Core is unavailable, which makes any filter here
 *     `{ in: [] }` → zero rows. That matches the existing fail-closed publish
 *     behaviour; the route sets `X-Core-Status: unavailable` so clients can say
 *     "search unavailable" rather than "no matches".
 *   - `termKey` must byte-match what `buildTermFilterGroup` emits in
 *     `packages/ui/src/course-list-view.tsx` (`${term}::${year}`), so a value can
 *     round-trip from the dropdown to the query string and back without translation.
 * Related: routes/courses.js, services/courseAccess.js, services/courseResolver.js
 */

/** The two values the Status dimension can take. */
export const COURSE_STATUS_VALUES = ['published', 'draft'];

/** The three buckets the Progress dimension can take (see progressBucket). */
export const COURSE_PROGRESS_VALUES = ['not-started', 'in-progress', 'completed'];

/**
 * Canonical term key for a Core course — `"W2::2026"` style, matching
 * `buildTermFilterGroup`. Returns null when either half is missing, in which case
 * the course belongs to no term and any term filter excludes it.
 */
export function coreTermKey(coreCourse) {
  const term = typeof coreCourse?.term === 'string' ? coreCourse.term.trim() : '';
  const year = coreCourse?.year;
  // `.trim()` matches `courseTerm()` in app/lib/course-display.ts, which is what
  // feeds `buildTermFilterGroup` — so the value the dropdown emits and the value
  // matched here are the same string.
  if (!term || typeof year !== 'number') return null;
  return `${term}::${year}`;
}

/** Status value for a Core course. Anything not explicitly published is a draft. */
export function coreStatusValue(coreCourse) {
  return coreCourse?.isPublished === true ? 'published' : 'draft';
}

/**
 * Case-insensitive substring match against a Core course's name and code.
 *
 * The haystack mirrors the client's `getSearchText` (`${title} ${code}`) so
 * server-side results are the ones users already expect from the in-page filter.
 *
 * @param {object} coreCourse
 * @param {string} query already lower-cased and trimmed by the caller.
 */
export function matchesCoreCourse(coreCourse, query) {
  if (!query) return true;
  const name = typeof coreCourse?.name === 'string' ? coreCourse.name : '';
  const code = typeof coreCourse?.code === 'string' ? coreCourse.code : '';
  return `${name} ${code}`.toLowerCase().includes(query);
}

/**
 * Build the Prisma where-fragment restricting to catalog courses that match every
 * supplied dimension.
 *
 * Semantics mirror `CourseListView`: OR *within* a dimension (any selected term
 * matches), AND *across* dimensions (a selected term AND a selected status).
 *
 * @param {Array<object>} catalogCourses
 * @param {{ search?: string, terms?: string[], statuses?: string[] }} criteria
 * @returns {{ coreOfferingId: { in: string[] } } | null} null when no criterion was
 *   supplied — the caller must then omit the fragment entirely. Returning
 *   `{ in: [] }` in that case would empty every list.
 */
export function coreFacetWhere(catalogCourses, { search, terms = [], statuses = [] } = {}) {
  const query = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (!query && terms.length === 0 && statuses.length === 0) return null;

  const ids = (catalogCourses ?? [])
    .filter((c) => {
      if (!c || typeof c.id !== 'string') return false;
      if (query && !matchesCoreCourse(c, query)) return false;
      if (terms.length > 0 && !terms.includes(coreTermKey(c))) return false;
      if (statuses.length > 0 && !statuses.includes(coreStatusValue(c))) return false;
      return true;
    })
    .map((c) => c.id);

  return { coreOfferingId: { in: ids } };
}

/**
 * Enumerate the distinct facet values present across a set of Core courses.
 *
 * Drives the filter dropdowns. This must be computed over the caller's WHOLE
 * accessible set rather than the current page — deriving options from a page is
 * exactly the bug #1208 exists to fix (a term that only appears on page 3 would
 * never be offered as a filter).
 *
 * Terms come back most-recent-first so the dropdown order matches the list's
 * section headings; status uses the fixed published-before-draft order.
 *
 * @returns {{ terms: string[], statuses: string[] }}
 */
export function coreFacets(catalogCourses) {
  const terms = new Set();
  const statuses = new Set();
  for (const c of catalogCourses ?? []) {
    if (!c) continue;
    const term = coreTermKey(c);
    if (term) terms.add(term);
    statuses.add(coreStatusValue(c));
  }
  return {
    terms: [...terms].toSorted(compareTermKeysDesc),
    statuses: COURSE_STATUS_VALUES.filter((v) => statuses.has(v)),
  };
}

/**
 * Term rank within a label year — copied from `TERM_RANK` in
 * `packages/ui/src/lib/term.ts` so both sides order terms identically.
 */
const TERM_RANK = { S1: 0, S2: 1, W1: 2, W2: 3 };

/**
 * Order term keys most-recent-first, mirroring the client's
 * `termSortKey` (`year * 10 + rank`, compared descending).
 *
 * A term string the shared model doesn't recognise ranks -1 and sorts last
 * within its year. The client runs such values through `normalizeTerm` first, so
 * the two can disagree on the *ordering* of non-canonical terms — harmless,
 * because the client re-sorts the options it is given via `optionSortKey`, and
 * the option *values* are byte-identical either way.
 */
function compareTermKeysDesc(a, b) {
  return termSortKey(b) - termSortKey(a);
}

function termSortKey(key) {
  const [term, year] = key.split('::');
  return (Number(year) || 0) * 10 + (TERM_RANK[term] ?? -1);
}
