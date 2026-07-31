/**
 * Helpers for AI-Tutor's paginated list endpoints (#1043).
 *
 * The AT list endpoints return the platform envelope
 * `{ data, total, page, pageSize }` instead of a bare array, and the course
 * lists (`/api/courses`, `/api/admin/courses`) parse pagination in *required*
 * mode — a GET with no `page`/`pageSize` is a 400 `PAGINATION_REQUIRED`, not a
 * defaulted first page. Specs must therefore send both params and read `.data`.
 *
 * Use `atListData` for the common "give me the rows" case; reach for
 * `atListResponse` only when the spec asserts on the status or the envelope
 * metadata itself.
 */
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Page size used by list calls that just want "everything the fixture made".
 * Matches the client's `COURSE_LIST_PAGE_SIZE`/`TREE_PAGE_SIZE` and the
 * server's `MAX_PAGE_SIZE`, so a single page covers any E2E-sized dataset.
 */
export const AT_LIST_PAGE_SIZE = 200;

/** GET an AT list endpoint with a complete `page`/`pageSize` pair. */
export function atListResponse(
  ctx: APIRequestContext,
  url: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<APIResponse> {
  const qs = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? AT_LIST_PAGE_SIZE),
  });
  return ctx.get(`${url}${url.includes('?') ? '&' : '?'}${qs}`);
}

/**
 * GET an AT list endpoint and return the envelope's rows, asserting the request
 * succeeded and the envelope is well-formed.
 */
export async function atListData<T = Record<string, unknown>>(
  ctx: APIRequestContext,
  url: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<T[]> {
  const res = await atListResponse(ctx, url, params);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.data)).toBe(true);
  return body.data as T[];
}
