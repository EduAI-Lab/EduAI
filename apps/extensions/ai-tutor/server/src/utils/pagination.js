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
 *     `defaultPageSize`. Used by the tree endpoints (modules / lessons /
 *     activities / topics), whose readers now drive a real pager but whose
 *     non-pager callers (breadcrumb lookups, dropdown feeds) still request a
 *     default page without spelling the params out.
 *
 * `parseSearchParam` (#1207) is the filter half of the same contract: search
 * narrowing happens in SQL, ANDed into the route's existing `where`, and the
 * SAME `where` feeds both the `count` and the `findMany` — so `total` is the
 * count of matching rows and the pager pages the filtered set.
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

/**
 * Upper bound on a `search` term. Long enough for a full activity question,
 * short enough that a pathological query can't turn into an expensive scan.
 */
export const MAX_SEARCH_LENGTH = 100;

/**
 * Parse the optional `search` query param.
 *
 * Absent, empty, or whitespace-only means "no filter" and returns `null` — the
 * caller then omits the search fragment entirely rather than ANDing a
 * match-everything clause. Internal whitespace is collapsed so `"foo   bar"`
 * and `"foo bar"` are the same query.
 *
 * A param that is present but not a string (`?search=a&search=b`, which Express
 * parses as an array) or longer than `maxLength` is a 400, for the same reason
 * malformed pagination is: silently coercing garbage hides caller bugs.
 *
 * @param {import('express').Request} req
 * @param {object} [opts]
 * @param {number} [opts.maxLength=100]
 * @returns {string | null} The normalized term, or `null` for "no filter".
 * @throws {PaginationError} `SEARCH_INVALID` on a non-string or over-long term.
 */
export function parseSearchParam(req, opts = {}) {
  const { maxLength = MAX_SEARCH_LENGTH } = opts;
  const raw = req.query.search;
  if (raw === undefined) return null;

  if (typeof raw !== 'string') {
    throw new PaginationError('search must be a single string', 'SEARCH_INVALID');
  }
  if (raw.length > maxLength) {
    throw new PaginationError(
      `search must be at most ${maxLength} characters`,
      'SEARCH_INVALID',
    );
  }

  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

/**
 * Build the Prisma `where` fragment for a search term across one or more
 * fields, ANDable onto a route's existing scope/visibility clause.
 *
 * Fields may be dotted relation paths (`'lesson.module.title'`), which expand
 * into nested relation filters — the activity import picker searches the parent
 * lesson and module titles that its option rows display.
 *
 * Returns `null` when there is no term. Callers AND it onto their scope rather
 * than spreading it, so a scope that already carries its own `OR` (published
 * visibility, manageable-course lists) can't be clobbered:
 *
 *   const frag = searchWhere(term, ['title']);
 *   const where = frag ? { AND: [scope, frag] } : scope;
 *
 * Note: `%` and `_` typed by the user are matched literally by Postgres' LIKE
 * only if escaped, and Prisma does not escape them in `contains`. The effect is
 * a harmless over-match on those two characters (no injection — the value is
 * still parameterized), so it is left alone rather than hand-rolling raw SQL.
 *
 * @param {string | null} term From `parseSearchParam`.
 * @param {string[]} fields Field names or dotted relation paths.
 * @returns {{ OR: object[] } | null}
 */
/**
 * Search fragment for an Activity, whose searchable text is split across a
 * column and a JSON blob.
 *
 * `title` and `instructionsMd` are real columns and match case-insensitively.
 * The question text lives in the `config` JSON (there is no `question` column),
 * under `question` on current rows and `prompt` on legacy ones — `mapActivity`
 * reads `config.question ?? config.prompt ?? instructionsMd`, so all three have
 * to be searchable or an activity displays question text that search can never
 * find. It is matched with Prisma's `string_contains`, which has NO `mode` option
 * and is therefore case-SENSITIVE. Rather than pretend otherwise, the term is
 * tried in the casings question text actually gets written in: as typed,
 * all-lower, all-upper, sentence case, and title case. The last two are what
 * make the common case work — "What is Photosynthesis?" contains neither
 * `photosynthesis` nor `PHOTOSYNTHESIS`, so a lowercase search used to miss any
 * capitalised word mid-sentence.
 *
 * This is still a heuristic. Matching JSON question text properly needs either a
 * real `question` column or a lowercased generated column to index — worth doing
 * if question search gets heavier use, but it is a migration, not a filter.
 *
 * @param {string | null} term
 * @param {string[]} [prefix] Relation path to the activity (e.g. `[]` when
 *   querying activities directly).
 * @returns {{ OR: object[] } | null}
 */
export function activitySearchWhere(term, prefix = []) {
  if (!term) return null;
  const nest = (leaf) => prefix.reduceRight((acc, segment) => ({ [segment]: acc }), leaf);
  const lower = term.toLowerCase();
  const sentence = lower.charAt(0).toUpperCase() + lower.slice(1);
  const title = lower.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  const casings = [...new Set([term, lower, term.toUpperCase(), sentence, title])];
  return {
    OR: [
      nest({ title: { contains: term, mode: 'insensitive' } }),
      nest({ instructionsMd: { contains: term, mode: 'insensitive' } }),
      ...['question', 'prompt'].flatMap((key) =>
        casings.map((cased) => nest({ config: { path: [key], string_contains: cased } })),
      ),
    ],
  };
}

export function searchWhere(term, fields) {
  if (!term || fields.length === 0) return null;
  const match = { contains: term, mode: 'insensitive' };
  const OR = fields.map((field) =>
    field
      .split('.')
      .reduceRight((acc, segment) => ({ [segment]: acc }), match),
  );
  return { OR };
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
