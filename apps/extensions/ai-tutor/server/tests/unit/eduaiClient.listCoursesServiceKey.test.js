/**
 * Unit tests for `listEduAiCoursesServiceKey` (#1082).
 *
 * This is the unscoped, service-key counterpart to `listEduAiCourses` — used
 * ONLY as a fallback (see `courseResolver.js`'s `resolveMissingCoreCourses`)
 * for AT-enrolled courses missing from a caller's cookie-scoped list. It
 * hits the same `GET /courses` endpoint Core's `getCourses` branches on
 * `Authorization: Bearer <serviceKey>` to return the full non-deleted catalog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listEduAiCoursesServiceKey } from '../../src/services/eduaiClient.js';

beforeEach(() => {
  process.env.EDUAI_BASE_URL = 'http://core.test/api';
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('listEduAiCoursesServiceKey', () => {
  it('throws when EDUAI_API_KEY is not configured — never silently returns an unauthenticated result', async () => {
    delete process.env.EDUAI_API_KEY;

    await expect(listEduAiCoursesServiceKey()).rejects.toThrow('EDUAI_API_KEY not configured');
  });

  it('requests GET /courses with the service key as a Bearer token', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 200 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await listEduAiCoursesServiceKey();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    // #1041: Core requires paging params on every list read.
    expect(url).toBe('http://core.test/api/courses?page=1&pageSize=200');
    expect(options.headers.Authorization).toBe('Bearer test-service-key-abc');
  });

  it('returns the full unscoped catalog on a valid response, including entries with no callerEnrollmentRole', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    const courses = [
      { id: 'core-1', name: 'Course One', isPublished: true },
      { id: 'core-2', name: 'Course Two', isPublished: false },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ data: courses, total: courses.length, page: 1, pageSize: 200 }),
      }),
    );

    const result = await listEduAiCoursesServiceKey();

    expect(result).toEqual(courses);
  });

  it('throws a 502 when the response is missing the paginated envelope (schema mismatch)', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ courses: 'unexpected legacy shape' }),
      }),
    );

    await expect(listEduAiCoursesServiceKey()).rejects.toMatchObject({ status: 502 });
  });

  it('refuses to return a partial catalog when an all: true walk would exceed the page cap (#1129 review)', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    // 50 pages × 200 is the cap; anything past it can only be answered partially,
    // and reconcile callers would read the missing tail as "deleted in Core".
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () =>
        Promise.resolve({ data: [{ id: 'core-1', name: 'One' }], total: 10_001, page: 1, pageSize: 200 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(listEduAiCoursesServiceKey({ all: true })).rejects.toMatchObject({ status: 502 });
    // Fails on the first page rather than walking 50 pages to return a partial set.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('walks every page when the total sits exactly on the cap', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () =>
          Promise.resolve({ data: [{ id: 'core-1', name: 'One' }], total: 10_000, page: 1, pageSize: 200 }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await expect(listEduAiCoursesServiceKey({ all: true })).resolves.toHaveLength(50);
    expect(mockFetch).toHaveBeenCalledTimes(50);
  });

  it('surfaces an upstream HTTP failure with its status', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('INVALID_SERVICE_KEY'),
      }),
    );

    await expect(listEduAiCoursesServiceKey()).rejects.toMatchObject({ status: 403 });
  });
});
