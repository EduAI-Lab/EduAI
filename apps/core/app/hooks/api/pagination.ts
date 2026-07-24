/**
 * Client-side helpers for Core's paginated list APIs (#1041).
 *
 * Every `/api/*` list endpoint returns `{ data, total, page, pageSize }` and
 * requires `page`/`pageSize`. State is kept in TanStack Table's shape
 * (`pageIndex` is 0-based) and converted to the API's 1-based `page` here, so
 * the tables can hand `pagination`/`onPaginationChange` straight to
 * `useReactTable` with `manualPagination`.
 */

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Max ids accepted by an unpaged `?ids=` lookup — mirrors the server's
 * `MAX_IDS_PER_REQUEST` (`pagination.server.ts`). Callers with a larger set
 * must chunk at this size or the request 400s with `IDS_TOO_MANY`.
 */
export const MAX_IDS_PER_REQUEST = 200;

export type PaginationState = {
  pageIndex: number;
  pageSize: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const initialPaginationState = (
  pageSize = DEFAULT_PAGE_SIZE,
): PaginationState => ({ pageIndex: 0, pageSize });

/** Serialize paging (plus any extra filters) into a query string. */
export function paginationQuery(
  state: PaginationState,
  extra?: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams({
    page: String(state.pageIndex + 1),
    pageSize: String(state.pageSize),
  });
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Serialize one unpaged `?ids=` batch lookup (#1125). Serializes a single batch
 * only — callers with more than {@link MAX_IDS_PER_REQUEST} ids must chunk at
 * that size (see `fetchUsersByIds`) or the request 400s with `IDS_TOO_MANY`.
 */
export function idsQuery(ids: string[]): string {
  return new URLSearchParams({ ids: ids.join(",") }).toString();
}
