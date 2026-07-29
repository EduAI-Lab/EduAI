/**
 * Shared server-side pagination helpers (#1041).
 *
 * Core's admin list endpoints (`/api/users`, `/api/courses`, `/api/ai-models`,
 * `/api/ai-providers`) are paginated at the database layer and return a single
 * envelope shape:
 *
 * ```json
 * { "data": [], "total": 0, "page": 1, "pageSize": 25 }
 * ```
 *
 * `page` and `pageSize` are **required** on those endpoints — there is no
 * full-list fallback. Callers that need to resolve a handful of records by
 * identity use `?ids=` instead (see `parseIdsParam`), which is mutually
 * exclusive with paging.
 */

import { apiError } from "~/lib/api-error.server";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
/** Upper bound on `?ids=` batch lookups so the escape hatch cannot become a full-table read. */
export const MAX_IDS_PER_REQUEST = 200;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

/**
 * Clamp caller-supplied paging to a sane window.
 *
 * Clamping (rather than rejecting) keeps URL-driven paging forgiving: a stale
 * `?page=0` link still renders the first page instead of erroring.
 */
export function normalizePagination(
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): { safePage: number; safePageSize: number; skip: number } {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
    : DEFAULT_PAGE_SIZE;
  return {
    safePage,
    safePageSize,
    skip: (safePage - 1) * safePageSize,
  };
}

/**
 * Read the required `page`/`pageSize` query params.
 *
 * Returns `{ response }` with a 400 when either param is missing or not a
 * number; out-of-range values are clamped by {@link normalizePagination}.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
): { pagination: Pagination } | { response: Response } {
  const rawPage = searchParams.get("page");
  const rawPageSize = searchParams.get("pageSize");

  const fields: Record<string, string> = {};
  if (rawPage === null) fields.page = "Required";
  if (rawPageSize === null) fields.pageSize = "Required";
  if (Object.keys(fields).length > 0) {
    return { response: apiError(400, "PAGINATION_REQUIRED", fields) };
  }

  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  if (!Number.isFinite(page)) fields.page = "Must be a number";
  if (!Number.isFinite(pageSize)) fields.pageSize = "Must be a number";
  if (Object.keys(fields).length > 0) {
    return { response: apiError(400, "PAGINATION_INVALID", fields) };
  }

  const { safePage, safePageSize, skip } = normalizePagination(page, pageSize);
  return {
    pagination: { page: safePage, pageSize: safePageSize, skip, take: safePageSize },
  };
}

/**
 * Read the optional `?ids=a,b,c` batch-lookup param (#1125).
 *
 * `ids` bypasses paging entirely, so it is rejected alongside `page`/`pageSize`
 * to keep the response shape unambiguous.
 */
export function parseIdsParam(
  searchParams: URLSearchParams,
): { ids: string[] | null } | { response: Response } {
  const raw = searchParams.get("ids");
  if (raw === null) return { ids: null };

  if (searchParams.has("page") || searchParams.has("pageSize")) {
    return {
      response: apiError(400, "IDS_AND_PAGE_EXCLUSIVE", {
        ids: "Cannot be combined with page/pageSize",
      }),
    };
  }

  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { response: apiError(400, "IDS_EMPTY", { ids: "Must contain at least one id" }) };
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return {
      response: apiError(400, "IDS_TOO_MANY", {
        ids: `At most ${MAX_IDS_PER_REQUEST} ids per request`,
      }),
    };
  }
  return { ids };
}

/** Read an optional free-text `?search=` filter, normalized to `null` when blank. */
export function parseSearchParam(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("search")?.trim();
  return raw ? raw : null;
}

/**
 * Build the standard paginated response envelope.
 *
 * `total` counts rows matching the caller's filters, so it changes as they
 * search. Unfiltered aggregates a UI needs regardless of the current query
 * (e.g. "142 total · 130 active") belong in `extra`.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  pagination: Pick<Pagination, "page" | "pageSize">,
  extra?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      data,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Envelope for `?ids=` / unpaged lookups: same shape, with `page`/`pageSize`
 * describing the returned set so clients can parse one response type.
 */
export function unpagedResponse<T>(data: T[]): Response {
  return new Response(
    JSON.stringify({
      data,
      total: data.length,
      page: 1,
      pageSize: data.length,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
