/**
 * URL plumbing for the server-filtered course lists (#1208).
 *
 * Search and filters live in the query string rather than component state, so a
 * filtered view is bookmarkable, survives reload, and — critically — is what the
 * loader reads. Filtering in the component would only ever narrow the page the
 * loader already fetched, which is the bug #1208 exists to fix.
 *
 * Shared by `routes/instructor.tsx` and `routes/student.tsx` so the two cannot
 * drift on param names, page-reset behaviour, or debounce timing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useDebouncedValue } from '~/hooks/useDebouncedValue';

/**
 * Filter dimensions carried in the URL. The keys double as both the query-param
 * name and the `CourseFilterGroup.id` the toolbar reports, so a change comes back
 * as the param to write — no translation table to keep in sync.
 */
export const COURSE_FILTER_KEYS = ['term', 'status', 'progress'] as const;
export type CourseFilterKey = (typeof COURSE_FILTER_KEYS)[number];

/**
 * Must byte-match `MAX_SEARCH_LENGTH` in `server/src/utils/pagination.js`, which
 * 400s (`SEARCH_TOO_LONG`) past it. Nothing between the search box and the fetch
 * used to bound the value, so a pasted paragraph threw out of the loader and
 * replaced the whole route with its error boundary — reproducibly, since the
 * over-long value stayed in the URL across reloads. Clamped on read (covers a
 * bookmarked or hand-edited URL) and on write (covers typing and pasting).
 */
export const MAX_COURSE_SEARCH_LENGTH = 200;

/**
 * Values the server accepts per enum dimension, mirroring `COURSE_STATUS_VALUES`
 * and `COURSE_PROGRESS_VALUES` in `server/src/utils/courseSearch.js`. Unknown
 * values are dropped rather than forwarded: the server rejects them with
 * `FILTER_INVALID`, which blanks the route exactly like an over-long search.
 * `term` is free-form (`W1::2026` keys are data, not an enum), so it has no set —
 * an unknown term simply matches nothing, which is the honest answer.
 */
const COURSE_FILTER_ALLOWED: Partial<Record<CourseFilterKey, readonly string[]>> = {
  status: ['published', 'draft'],
  progress: ['not-started', 'in-progress', 'completed'],
};

export interface CourseListSelection {
  page: number;
  search: string;
  filters: Record<CourseFilterKey, string[]>;
}

/** Read the current selection out of a request URL, for use in a loader. */
export function readCourseListSelection(url: URL): CourseListSelection {
  const requestedPage = Number(url.searchParams.get('page'));
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const filters = {} as Record<CourseFilterKey, string[]>;
  for (const key of COURSE_FILTER_KEYS) {
    const allowed = COURSE_FILTER_ALLOWED[key];
    filters[key] = url.searchParams
      .getAll(key)
      .filter(Boolean)
      .filter((value) => !allowed || allowed.includes(value));
  }

  const search = (url.searchParams.get('search')?.trim() ?? '').slice(0, MAX_COURSE_SEARCH_LENGTH);

  return { page, search, filters };
}

/** True when anything is narrowing the list — drives "no results" vs "empty" copy. */
export function hasActiveCourseFilters(selection: CourseListSelection): boolean {
  return (
    selection.search.length > 0
    || COURSE_FILTER_KEYS.some((key) => selection.filters[key].length > 0)
  );
}

/**
 * Wire a `CourseListView` in controlled mode to the URL.
 *
 * Search is debounced (one navigation per pause, not per keystroke) and pushed
 * with `replace` so typing doesn't fill the history stack. Filter clicks are
 * discrete, so they apply immediately and push a real history entry.
 *
 * Every mutation drops `page`: results shift under a new query, so keeping the
 * old page number would land the user on a page that may no longer exist.
 */
export function useCourseListFilters(selection: CourseListSelection) {
  const [, setSearchParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(selection.search);
  const debouncedSearch = useDebouncedValue(searchDraft);

  // What the URL currently holds. Compared against the debounced draft so this
  // effect only navigates on a real change — without it, every render that
  // re-created the params would push a redundant navigation.
  const committedSearch = useRef(selection.search);

  // Keep the input in step when the URL changes from elsewhere (back/forward, a
  // "clear" link), but never clobber what the user is mid-way through typing.
  useEffect(() => {
    if (selection.search !== committedSearch.current) {
      committedSearch.current = selection.search;
      setSearchDraft(selection.search);
    }
  }, [selection.search]);

  useEffect(() => {
    const next = debouncedSearch.trim().slice(0, MAX_COURSE_SEARCH_LENGTH);
    if (next === committedSearch.current) return;
    committedSearch.current = next;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set('search', next);
        else params.delete('search');
        params.delete('page');
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [debouncedSearch, setSearchParams]);

  const setFilter = useCallback(
    (groupId: string, values: string[]) => {
      if (!COURSE_FILTER_KEYS.includes(groupId as CourseFilterKey)) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete(groupId);
          for (const value of values) params.append(groupId, value);
          params.delete('page');
          return params;
        },
        { preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  const clearAll = useCallback(() => {
    committedSearch.current = '';
    setSearchDraft('');
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete('search');
        params.delete('page');
        for (const key of COURSE_FILTER_KEYS) params.delete(key);
        return params;
      },
      { preventScrollReset: true },
    );
  }, [setSearchParams]);

  const goToPage = useCallback(
    (nextPage: number) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('page', String(nextPage));
          return params;
        },
        { preventScrollReset: false },
      );
    },
    [setSearchParams],
  );

  return { searchDraft, setSearchDraft, setFilter, clearAll, goToPage };
}
