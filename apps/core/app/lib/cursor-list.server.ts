/**
 * Shared cursor-based "load more" pagination helpers (#1042).
 *
 * Distinct from `pagination.server.ts`, which paginates the page-numbered admin
 * tables (#1041). The Core lists bounded here (course roster, chat transcripts,
 * course/unit chat lists, course materials) are rendered as growing feeds rather
 * than page-numbered tables, so they use an opaque `cursor` + `limit` +
 * `nextCursor` envelope instead of `page`/`pageSize`.
 *
 * Both `cursor` and `limit` are optional — omitting them returns the first page
 * at `DEFAULT_LIST_LIMIT` so existing callers that don't yet know about paging
 * keep working, just bounded instead of unbounded.
 */

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 100;

export type CursorParams = { cursor: string | null; limit: number };

export function parseCursorParams(searchParams: URLSearchParams): CursorParams {
  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIST_LIMIT, Math.floor(rawLimit))
      : DEFAULT_LIST_LIMIT;
  const cursor = searchParams.get("cursor")?.trim() || null;
  return { cursor, limit };
}

/**
 * Split a `take: limit + 1` lookahead result into the page to return and the
 * next cursor. `nextCursor` is the id of the last row of the page — Prisma's
 * `cursor: { id }, skip: 1` pattern resumes immediately after it.
 */
export function splitPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const page = rows.slice(0, limit);
    return { page, nextCursor: page[page.length - 1]!.id };
  }
  return { page: rows, nextCursor: null };
}
