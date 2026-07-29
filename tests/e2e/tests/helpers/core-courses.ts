/**
 * Helpers for Core's paginated `GET /api/courses` (#1041).
 *
 * The endpoint requires `page`/`pageSize` and answers with
 * `{ data, total, page, pageSize }` — there is no full-list mode. `?ids=` is
 * the unpaged batch-lookup surface (#1125) and is the right tool for
 * visibility assertions: "can this caller see course X" is a lookup, not a
 * scan of whatever landed on page 1.
 */
import type { APIRequestContext } from '@playwright/test';
import { CORE_URL } from '../../playwright.config';

export const CORE_PAGE_SIZE = 100;

export type CoursePage = {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
};

/** One page of the caller's visible Core courses. */
export async function listCoreCoursePage(
  ctx: APIRequestContext,
  { page = 1, pageSize = CORE_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ status: number; body: CoursePage }> {
  const res = await ctx.get(`${CORE_URL}/api/courses?page=${page}&pageSize=${pageSize}`);
  return { status: res.status(), body: await res.json() };
}

/**
 * Whether `courseId` is visible to the caller, via `?ids=`. Access scoping is
 * applied before the id selector, so a course the caller may not see comes
 * back as an empty set rather than a row.
 */
export async function canSeeCoreCourse(
  ctx: APIRequestContext,
  courseId: string,
): Promise<boolean> {
  const res = await ctx.get(`${CORE_URL}/api/courses?ids=${encodeURIComponent(courseId)}`);
  if (res.status() !== 200) return false;
  const body = await res.json();
  return (body.data ?? []).some((c: any) => c.id === courseId);
}
