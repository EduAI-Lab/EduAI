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
 *   - Returns Sequelize-shaped `{ limit, offset }` (not Prisma `take`/`skip`),
 *     so callers pass the result straight into `findAndCountAll`.
 *   `page` clamps to `>= 1`. `pageSize` clamps to `1..maxPageSize`.
 *
 * Two parsing modes:
 *   - required (default): the caller MUST send `page`/`pageSize`; absent or
 *     unparseable values throw a 400-shaped `PaginationError`. Used by the
 *     unbounded lists (course list, questions-in-assessment).
 *   - optional (`required: false`): missing params fall back to page 1 at
 *     `defaultPageSize`, and `explicit` is false so `pageOf`/route callers
 *     return the whole set instead of truncating a caller that never asked to
 *     page. Used by structure-bounded lists (topics, sections, variants).
 *
 * Related: `src/utils/` siblings, `app/frontend/src/services/api.ts`
 * (`Paginated<T>`).
 */

export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Upper clamp for `page`. Without it an unbounded value (`?page=1e20`) reaches
 * Sequelize as `OFFSET 2e+22`, which Postgres rejects as out of bigint range —
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
    // Did the caller actually ask to page? Optional-mode routes use this to
    // tell "wants page N" from "wants the whole set" — without it they'd
    // silently truncate every legacy caller at `defaultPageSize`.
    explicit: hasPage || hasPageSize,
  };
}

/**
 * Envelope a full in-memory result set as one page.
 *
 * When the caller passed no pagination params (optional mode), the whole set is
 * returned rather than the first `defaultPageSize` rows — a reader that never
 * asked to page must not have rows silently dropped. When they did ask, the
 * requested window is sliced out and `total` still reports the full count.
 *
 * @template T
 * @param {T[]} rows Full ordered result set.
 * @param {ReturnType<typeof parsePaginationParams>} pagination
 */
export function pageOf(rows, pagination) {
  if (!pagination.explicit) {
    return paginated(rows, rows.length, {
      page: 1,
      pageSize: Math.max(rows.length, 1),
    });
  }
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
