/**
 * @file Server-side pagination helpers.
 *
 * Responsibility: Parse `page`/`pageSize` query params and shape list responses
 *   into the platform pagination envelope. This is the single source of the
 *   pagination contract for the AI-Tutor Express server.
 *
 * Contract (#1043) — mirrors EduAI Core's `pagination.server.ts` (#1041):
 *   Response envelope: `{ data: [...], total, page, pageSize }`.
 *   `page` clamps to `1..MAX_PAGE`. `pageSize` clamps to `1..MAX_PAGE_SIZE`.
 *
 * Two parsing modes. They differ ONLY on absent params — a param that is
 * present but unparseable is a 400 in both, so the same malformed input never
 * gets two different answers depending on the endpoint:
 *   - required (default): the caller MUST send `page`/`pageSize`; absent
 *     values throw a 400-shaped `PaginationError`. Used by the
 *     unbounded list endpoints (courses, admin lists, importable activities).
 *   - optional (`required: false`): missing params fall back to page 1 at
 *     `defaultPageSize`. Used by the structure-bounded tree endpoints
 *     (modules / lessons / activities / topics) whose readers need the whole
 *     set (drag-and-drop reorder, ordinal derivation, the lesson player) and
 *     request one bounded page rather than a real pager.
 *
 * Related: `server/src/utils/mappers.js`, `app/lib/api.ts` (`Paginated<T>`).
 */

export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Upper clamp for `page`. `skip` is derived as `(page - 1) * pageSize`, so an
 * unbounded finite `page` (e.g. `?page=1e18`) would produce an offset past
 * `Number.MAX_SAFE_INTEGER` and hand Prisma a nonsense/overflowing value. This
 * ceiling keeps the worst-case offset at `MAX_PAGE * MAX_PAGE_SIZE` = 2e8,
 * comfortably safe, while sitting far above any reachable real page.
 */
export const MAX_PAGE = 1_000_000;

/**
 * A 400-shaped error thrown when required pagination params are missing or
 * invalid. Routes translate this into `res.status(400).json({ error, code })`.
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
 * Malformed values (`?page=abc`) are rejected with 400 in BOTH modes — only
 * *absent* params differ between modes, since silently coercing garbage to a
 * default hides caller bugs and made the two modes disagree on the same input.
 *
 * @param {import('express').Request} req
 * @param {object} [opts]
 * @param {boolean} [opts.required=true] Throw when params are absent.
 * @param {number} [opts.defaultPageSize=25] Fallback size when not required.
 * @param {number} [opts.maxPageSize=200] Upper clamp for `pageSize`.
 * @returns {{ page: number, pageSize: number, skip: number, take: number }}
 * @throws {PaginationError} when params are absent (required mode) or malformed
 *   (either mode).
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

  // Validate only what the caller actually sent. A param that is present but
  // unparseable is a 400 in both modes; an absent one already either threw
  // above (required) or fell back to its default (optional).
  if (
    (hasPage && !Number.isFinite(pageNum)) ||
    (hasPageSize && !Number.isFinite(pageSizeNum))
  ) {
    throw new PaginationError(
      'page and pageSize must be numbers',
      'PAGINATION_INVALID',
    );
  }

  const page = clampInt(pageNum, 1, MAX_PAGE);
  const pageSize = clampInt(pageSizeNum, 1, maxPageSize);

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Wrap a page of rows in the response envelope.
 *
 * @template T
 * @param {T[]} data Rows for the current page (already mapped to DTOs).
 * @param {number} total Total row count matching the query's `where`.
 * @param {{ page: number, pageSize: number }} params From parsePaginationParams.
 * @returns {{ data: T[], total: number, page: number, pageSize: number }}
 */
export function paginated(data, total, { page, pageSize }) {
  return { data, total, page, pageSize };
}
