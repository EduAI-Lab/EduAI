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
      json: () => Promise.resolve({ courses: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await listEduAiCoursesServiceKey();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses');
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
        json: () => Promise.resolve({ courses }),
      }),
    );

    const result = await listEduAiCoursesServiceKey();

    expect(result).toEqual(courses);
  });

  it('throws a 502 when the response is missing the courses envelope (schema mismatch)', async () => {
    process.env.EDUAI_API_KEY = 'test-service-key-abc';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ data: 'unexpected shape' }),
      }),
    );

    await expect(listEduAiCoursesServiceKey()).rejects.toMatchObject({ status: 502 });
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
