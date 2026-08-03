/**
 * @file URL <-> list-query plumbing shared by the paged tree routes (#1207).
 *
 * Responsibility: read `?page=` / `?search=` out of a loader's request URL, and
 *   keep a hand-edited or bookmarked URL from disagreeing with what renders.
 *
 * Why the URL owns this rather than component state: the pager and the search
 * box must both survive reload and back/forward, and the loader is what issues
 * the request — holding either in `useState` would let the fetched page and the
 * address bar drift apart. `app/routes/instructor.tsx` established the pattern
 * for `page`; this generalizes it and adds `search`.
 *
 * Related: `app/components/common/PaginationControls.tsx`,
 * `app/components/common/ListSearchInput.tsx`, `app/lib/api.ts` (`ListParams`).
 */
import { redirect } from 'react-router';

/**
 * Mirror of the server's `MAX_SEARCH_LENGTH` (`server/src/utils/pagination.js`).
 *
 * Kept in sync deliberately: a longer term is a 400 (`SEARCH_INVALID`), and a
 * loader has nowhere to put that but the route error boundary.
 */
export const MAX_SEARCH_LENGTH = 100;

export interface ListUrlParams {
  page: number;
  /**
   * Normalized term, or `''` for "no filter" — never `null`, so it can be
   * handed straight to an input's value without a nullish dance.
   */
  search: string;
}

/**
 * Parse `?page=` / `?search=` from a loader request URL.
 *
 * A malformed or non-positive `page` falls back to 1 rather than erroring: a
 * junk page number in a shared link should still render something useful. For
 * the same reason an over-long `search` is truncated to the server's limit
 * instead of being passed through — the API answers a longer term with a 400
 * (`SEARCH_INVALID`), which a loader can only surface as the route error
 * boundary, replacing the whole page over a pasted paragraph.
 */
export function parseListUrlParams(request: Request): ListUrlParams {
  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get('page'));
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  return { page, search };
}

/**
 * Redirect to the last real page when `?page=` points past the end.
 *
 * Redirecting rather than silently clamping (the #1162 decision on the course
 * list) keeps the URL and the rendered page from disagreeing — a clamp would
 * render page 4 while the address bar still claimed page 40. This matters more
 * with search in play, since narrowing the term shrinks the page count under a
 * `?page=` the user already has.
 *
 * @throws {Response} a redirect when `page` exceeds the last page.
 */
export function redirectPastEnd(
  request: Request,
  { page, total, pageSize }: { page: number; total: number; pageSize: number },
): void {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (page <= lastPage) return;
  const url = new URL(request.url);
  url.searchParams.set('page', String(lastPage));
  throw redirect(`${url.pathname}${url.search}`);
}

/**
 * Absolute 0-based ordinal of a row from its index on the current page.
 *
 * This is what makes a drag on page 3 meaningful to `PATCH .../position`, which
 * takes an ordinal across the whole list rather than a page-local index.
 */
export function absoluteOrdinal(page: number, pageSize: number, indexOnPage: number): number {
  return (page - 1) * pageSize + indexOnPage;
}

/**
 * Index, in the dropped order, of the row the user actually dragged.
 *
 * `SortableProvider` hands back `arrayMove(ids, oldIndex, newIndex)`, so every
 * row between the source and the target shifts by one and the naive "first index
 * whose id changed" names the dragged row only for an *upward* drag. For a
 * downward drag the first divergence is the row that merely shifted up, and the
 * dragged row sits at the *last* divergence instead. Telling the two apart: on a
 * downward drag the id that used to be at the first divergence has landed on the
 * last one.
 *
 * A swap of two neighbours is genuinely ambiguous — "A moved down one" and "B
 * moved up one" describe the same two arrays and persist the same order — so it
 * resolves to the first index.
 *
 * @returns the index in `orderedIds`, or `-1` when nothing moved.
 */
export function movedRowIndex(orderedIds: number[], previousIds: number[]): number {
  const first = orderedIds.findIndex((id, index) => id !== previousIds[index]);
  if (first === -1) return -1;
  let last = orderedIds.length - 1;
  while (last > first && orderedIds[last] === previousIds[last]) last -= 1;
  if (last - first <= 1) return first;
  return orderedIds[last] === previousIds[first] ? last : first;
}
