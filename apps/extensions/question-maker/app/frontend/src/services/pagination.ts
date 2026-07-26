/**
 * Client-side page walking for QM's server-paginated list endpoints (#1044).
 *
 * Every list endpoint now returns a bounded window (see the backend's
 * `utils/pagination.js`), so a reader that genuinely needs the whole set has to
 * walk pages rather than rely on the server returning everything. This is that
 * walk, in one place, so each caller doesn't reinvent the termination rules.
 *
 * Callers that want a single page with its metadata should not use this — they
 * fetch one page and render `PaginationControls` against the envelope's
 * `total`/`page`/`pageSize`.
 *
 * Related: `services/api.ts` (`Paginated<T>`),
 * `components/common/PaginationControls.tsx`.
 */
import api, { type Paginated } from './api';

/**
 * Server page size for whole-set reads. Matches `MAX_PAGE_SIZE` in the
 * backend's `utils/pagination.js` — asking for more is clamped there, so this
 * is the fewest roundtrips a whole-set read can make.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * Walks every page of a paginated endpoint and returns the concatenated rows.
 *
 * Termination is deliberately belt-and-braces, because `total` is recomputed
 * per request and the underlying set can change mid-walk:
 *   - stop once `rows.length >= total` (the normal exit),
 *   - stop on a short page, so a set that *shrinks* between requests can't
 *     leave `total` permanently out of reach and spin,
 *   - stop on an empty page, so an offset past a shrunken end exits,
 *   - hard-cap the page count, so a server that reported a bad `total` can
 *     never hang the caller in an unbounded request loop.
 *
 * @param path Endpoint path, e.g. `/api/course/12/topics`.
 * @param params Extra query params merged into every page request.
 * @param pageSize Rows per request; clamped server-side to `MAX_PAGE_SIZE`.
 */
export async function fetchAllPages<T>(
    path: string,
    params: Record<string, unknown> = {},
    pageSize: number = MAX_PAGE_SIZE,
): Promise<T[]> {
    const MAX_PAGES = 1000;
    const rows: T[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await api.get(path, { params: { ...params, page, pageSize } });
        const envelope = response.data as Paginated<T>;
        const data = Array.isArray(envelope?.data) ? envelope.data : [];

        rows.push(...data);

        const total = typeof envelope?.total === 'number' ? envelope.total : rows.length;
        if (data.length === 0 || data.length < pageSize || rows.length >= total) break;
    }

    return rows;
}
