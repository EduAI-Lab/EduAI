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

/** Upper bound on a `search` query string. */
export const MAX_SEARCH_LENGTH = 200;

/** Upper bound on how many values one repeatable filter param may carry. */
export const MAX_FILTER_VALUES = 25;

/**
 * Parse an optional free-text `search` query param.
 *
 * Absent, empty, or whitespace-only all yield `undefined` — so `?search=` behaves
 * exactly like sending no param at all, rather than filtering on the empty string
 * and returning everything-or-nothing depending on the caller's match logic.
 *
 * Rejected with 400 (`PaginationError`):
 *   - a repeated param (`?search=a&search=b`), which Express hands over as an
 *     array — silently taking `[0]` would drop half the caller's intent;
 *   - anything longer than `maxLength`, so an oversized query can't be used to
 *     burn CPU scanning the Core catalog on every request.
 *
 * @returns {string|undefined} the trimmed query, or undefined when unset.
 */
export function parseSearchParam(req, { param = 'search', maxLength = MAX_SEARCH_LENGTH } = {}) {
  const raw = req.query?.[param];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new PaginationError(`${param} must be a single value`, 'SEARCH_INVALID');
  }
  if (raw.length > maxLength) {
    throw new PaginationError(`${param} must be at most ${maxLength} characters`, 'SEARCH_TOO_LONG');
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parse a repeatable multi-select filter param (`?term=2026W2&term=2025W1`).
 *
 * Normalizes Express's `string | string[]` shape to a de-duped `string[]`, drops
 * blanks, and returns `[]` when the param is absent — so callers can treat "no
 * filter" and "empty filter" identically without a null check.
 *
 * Rejected with 400 (`PaginationError`):
 *   - a value outside `allowed`, when given. An unknown enum value is a client
 *     bug; answering it with an empty list would look like "no matching courses"
 *     and hide the mistake.
 *   - more than `maxValues` values.
 *
 * @param {import('express').Request} req
 * @param {string} param
 * @param {{ allowed?: string[], maxValues?: number }} [opts]
 * @returns {string[]}
 */
export function parseFilterParam(req, param, { allowed, maxValues = MAX_FILTER_VALUES } = {}) {
  const raw = req.query?.[param];
  if (raw === undefined || raw === null) return [];

  const list = Array.isArray(raw) ? raw : [raw];
  if (list.some((v) => typeof v !== 'string')) {
    throw new PaginationError(`${param} values must be strings`, 'FILTER_INVALID');
  }

  const values = [...new Set(list.map((v) => v.trim()).filter((v) => v !== ''))];
  if (values.length > maxValues) {
    throw new PaginationError(`${param} accepts at most ${maxValues} values`, 'FILTER_TOO_MANY');
  }
  if (allowed) {
    const bad = values.find((v) => !allowed.includes(v));
    if (bad !== undefined) {
      throw new PaginationError(`${param} has an unsupported value: ${bad}`, 'FILTER_INVALID');
    }
  }
  return values;
}
