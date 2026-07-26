/**
 * Unit tests for the `?ids=` course lookup path (#1125) and the paged
 * `/ai-models` read (#1041).
 *
 * `fetchCoursesByIds` is the shared helper behind `findEduAiCourseById` and
 * `listEduAiCoursesServiceKey({ ids })`. It replaced a page-walk-and-scan, so
 * the behaviour worth pinning is that it (a) never hits the network for an
 * empty set, (b) dedupes, and (c) chunks at Core's `?ids=` cap — Core answers
 * IDS_TOO_MANY past `CORE_PAGE_SIZE`, which would lose the whole result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CORE_PAGE_SIZE,
  findEduAiCourseById,
  listEduAiCourses,
  listEduAiCoursesServiceKey,
  listEduAiModels,
} from '../../src/services/eduaiClient.js';

vi.mock('../../src/services/systemSettings.js', () => ({
  getEffectiveEduAiApiKey: vi.fn(),
}));
import { getEffectiveEduAiApiKey } from '../../src/services/systemSettings.js';

beforeEach(() => {
  process.env.EDUAI_BASE_URL = 'http://core.test/api';
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Answers every `?ids=` request with one course row per requested id. */
function mockCoursesByIds() {
  return vi.fn((url) => {
    const ids = new URLSearchParams(url.split('?')[1]).get('ids');
    const data = (ids ? ids.split(',') : []).map((id) => ({ id, name: `Course ${id}` }));
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data, total: data.length, page: 1, pageSize: data.length }),
    });
  });
}

describe('findEduAiCourseById', () => {
  it('returns null for a missing course id without hitting the network', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(findEduAiCourseById('', { cookie: 'session=abc' })).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws 401 without a session cookie', async () => {
    await expect(findEduAiCourseById('core-1')).rejects.toMatchObject({ status: 401 });
  });

  it('resolves one course through a single unpaged ?ids= request, not a page-walk', async () => {
    const mockFetch = mockCoursesByIds();
    vi.stubGlobal('fetch', mockFetch);

    const course = await findEduAiCourseById('core-1', { cookie: 'session=abc' });

    expect(course).toMatchObject({ id: 'core-1' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://core.test/api/courses?ids=core-1');
    // `?ids=` is unpaged and mutually exclusive with paging.
    expect(url).not.toContain('page=');
    expect(options.headers.cookie).toBe('session=abc');
  });

  it('returns null when Core answers with no matching row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 0 }),
      }),
    );

    await expect(findEduAiCourseById('core-missing', { cookie: 'session=abc' })).resolves.toBeNull();
  });
});

describe('listEduAiCourses', () => {
  it('throws 401 without a session cookie', async () => {
    await expect(listEduAiCourses()).rejects.toMatchObject({ status: 401 });
  });
});

describe('listEduAiCoursesServiceKey (ids)', () => {
  it('returns an empty list for an empty id set without hitting the network', async () => {
    process.env.EDUAI_API_KEY = 'service-key';
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(listEduAiCoursesServiceKey({ ids: [] })).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dedupes ids and drops falsy entries before requesting', async () => {
    process.env.EDUAI_API_KEY = 'service-key';
    const mockFetch = mockCoursesByIds();
    vi.stubGlobal('fetch', mockFetch);

    const courses = await listEduAiCoursesServiceKey({ ids: ['c1', 'c1', null, '', 'c2'] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://core.test/api/courses?ids=c1%2Cc2');
    expect(courses.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('chunks more than CORE_PAGE_SIZE ids into separate capped requests and combines them', async () => {
    process.env.EDUAI_API_KEY = 'service-key';
    const mockFetch = mockCoursesByIds();
    vi.stubGlobal('fetch', mockFetch);
    const ids = Array.from({ length: CORE_PAGE_SIZE + 30 }, (_, i) => `c${i}`);

    const courses = await listEduAiCoursesServiceKey({ ids });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [url] of mockFetch.mock.calls) {
      const requested = new URLSearchParams(url.split('?')[1]).get('ids').split(',');
      expect(requested.length).toBeLessThanOrEqual(CORE_PAGE_SIZE);
    }
    // No id is dropped or double-counted across the chunk boundary.
    expect(courses.map((c) => c.id)).toEqual(ids);
  });

  it('forwards the service key as a Bearer token on the ids lookup', async () => {
    process.env.EDUAI_API_KEY = 'service-key';
    const mockFetch = mockCoursesByIds();
    vi.stubGlobal('fetch', mockFetch);

    await listEduAiCoursesServiceKey({ ids: ['c1'] });

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer service-key');
  });

  it('surfaces a 502 when Core answers the ids lookup with a non-envelope body', async () => {
    process.env.EDUAI_API_KEY = 'service-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        // Pre-#1041 shape — a bare array instead of `{ data, total, ... }`.
        json: () => Promise.resolve([{ id: 'c1' }]),
      }),
    );

    await expect(listEduAiCoursesServiceKey({ ids: ['c1'] })).rejects.toMatchObject({ status: 502 });
  });
});

describe('listEduAiModels', () => {
  it('throws 503 when no service key is configured', async () => {
    getEffectiveEduAiApiKey.mockResolvedValue(null);

    await expect(listEduAiModels()).rejects.toMatchObject({ status: 503 });
  });

  it('sends paging params and unwraps the envelope (#1041)', async () => {
    getEffectiveEduAiApiKey.mockResolvedValue('service-key');
    const models = [{ id: 'm1', modelId: 'gpt' }];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data: models, total: 1, page: 1, pageSize: CORE_PAGE_SIZE }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(listEduAiModels()).resolves.toEqual(models);
    expect(mockFetch.mock.calls[0][0]).toBe(
      `http://core.test/api/ai-models?page=1&pageSize=${CORE_PAGE_SIZE}`,
    );
  });

  it('throws when the models response is not an envelope — a bare array must not pass', async () => {
    getEffectiveEduAiApiKey.mockResolvedValue('service-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve([{ id: 'm1' }]),
      }),
    );

    await expect(listEduAiModels()).rejects.toThrow('Invalid response from EduAI models endpoint');
  });
});
