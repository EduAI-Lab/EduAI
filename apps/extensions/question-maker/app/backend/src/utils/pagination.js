/**
 * @file Server-side pagination helpers for Question Maker's list endpoints.
 *
 * Responsibility: parse `page`/`pageSize` query params and shape list responses
 *   into the platform pagination envelope. Single source of the pagination
 *   contract for the QM Express backend (#1044).
 *
 * Contract — mirrors AI-Tutor's `server/src/utils/pagination.js` (#1043) and
 * Core's `pagination.server.ts` (#1041), with two QM-specific deltas:
 *   - Envelope keeps QM's existing `success` flag:
 *       `{ success: true, data: [...], total, page, pageSize }`.
 *   - Returns ORM-neutral `{ limit, offset }` alongside `{ page, pageSize }`;
 *     Prisma callers map these onto `take`/`skip`.
 *   `page` clamps to `>= 1`. `pageSize` clamps to `1..maxPageSize`.
 *
 * Two parsing modes — both always yield a bounded window, so no endpoint can
 * return an unbounded row set:
 *   - required (default): the caller MUST send `page`/`pageSize`; absent or
 *     unparseable values throw a 400-shaped `PaginationError`. Used by the
 *     unbounded lists (course list).
 *   - default (`required: false`): missing params fall back to page 1 at
 *     `defaultPageSize`. Used by structure-bounded lists (topics, sections,
 *     assessment questions, variants) so a legacy caller still gets a valid
 *     first page rather than a 400 — but it gets a *page*, not the whole set.
 *     Clients that need every row walk pages (`fetchAllPages` in
 *     `app/frontend/src/services/pagination.ts`).
 *
 * Partial params (only `page` or only `pageSize`) are handled per mode:
 *   - required mode: rejected with `PAGINATION_REQUIRED` — both or neither.
 *   - default mode: the supplied param is honoured and the missing one takes
 *     its default (`page` → 1, `pageSize` → `defaultPageSize`).
 *
 * Related: `src/utils/` siblings, `app/frontend/src/services/api.ts`
 * (`Paginated<T>`).
 */

export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Upper clamp for `page`. Without it an unbounded value (`?page=1e20`) reaches
 * the DB as `OFFSET 2e+22`, which Postgres rejects as out of bigint range —
 * the client gets a 500 instead of an empty page. Optional mode deliberately
 * doesn't throw on junk params, so the guard has to be a clamp, not a check.
 */
const MAX_PAGE = 1_000_000;

/**
 * A 400-shaped error thrown when required pagination params are missing or
 * invalid. Routes translate this into
 * `res.status(400).json({ success: false, error, code })`.
 */
export class PaginationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PaginationError';
    this.status = 400;
    this.code = code;
  }
}

function clampInt(value, min, max) {
  const n = Math.floor(value);
  if (n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/**
 * Parse `page`/`pageSize` from an Express request's query string.
 *
 * In required mode both params must be present — supplying only one is a
 * `PAGINATION_REQUIRED` 400, so a caller can't half-page by accident. In
 * default mode either param may stand alone and the other takes its default.
 *
 * @param {import('express').Request} req
 * @param {object} [opts]
 * @param {boolean} [opts.required=true] Throw when params are absent/invalid.
 * @param {number} [opts.defaultPageSize=25] Fallback size when not required.
 * @param {number} [opts.maxPageSize=200] Upper clamp for `pageSize`.
 * @returns {{ page: number, pageSize: number, limit: number, offset: number }}
 * @throws {PaginationError} when `required` and params are missing/invalid.
 */
export function parsePaginationParams(req, opts = {}) {
  const {
    required = true,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    maxPageSize = MAX_PAGE_SIZE,
  } = opts;

  const rawPage = req.query.page;
  const rawPageSize = req.query.pageSize;
  const hasPage = rawPage !== undefined && rawPage !== '';
  const hasPageSize = rawPageSize !== undefined && rawPageSize !== '';

  if (required && (!hasPage || !hasPageSize)) {
    throw new PaginationError(
      'page and pageSize query params are required',
      'PAGINATION_REQUIRED',
    );
  }

  const pageNum = hasPage ? Number(rawPage) : 1;
  const pageSizeNum = hasPageSize ? Number(rawPageSize) : defaultPageSize;

  if (required && (!Number.isFinite(pageNum) || !Number.isFinite(pageSizeNum))) {
    throw new PaginationError(
      'page and pageSize must be numbers',
      'PAGINATION_INVALID',
    );
  }

  const page = Number.isFinite(pageNum) ? clampInt(pageNum, 1, MAX_PAGE) : 1;
  const pageSize = Number.isFinite(pageSizeNum)
    ? clampInt(pageSizeNum, 1, maxPageSize)
    : defaultPageSize;

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

/**
 * Slice one page out of a fully-materialised, ordered result set.
 *
 * Used by the routes whose underlying query can't take an honest SQL
 * `limit`/`offset` (nested eager-loaded includes, or a JS-side visibility
 * filter). The window is always bounded — an offset past the end yields an
 * empty `data` with `total` still reporting the real count, which is what lets
 * a client walk pages and stop on a short page.
 *
 * @template T
 * @param {T[]} rows Full ordered result set.
 * @param {ReturnType<typeof parsePaginationParams>} pagination
 */
export function pageOf(rows, pagination) {
  const window = rows.slice(pagination.offset, pagination.offset + pagination.limit);
  return paginated(window, rows.length, pagination);
}

/**
 * Wrap a page of rows in the response envelope.
 *
 * @template T
 * @param {T[]} data Rows for the current page (already mapped for the wire).
 * @param {number} total Total row count matching the query's `where`.
 * @param {{ page: number, pageSize: number }} params From parsePaginationParams.
 * @returns {{ success: true, data: T[], total: number, page: number, pageSize: number }}
 */
export function paginated(data, total, { page, pageSize }) {
  return { success: true, data, total, page, pageSize };
}
