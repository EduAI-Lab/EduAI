/**
 * Unit tests for setCoreCoursePublishState — the write-through helper that
 * propagates AI Tutor publish/unpublish actions to Core (#477).
 *
 * Core is the source of truth for isPublished. When an instructor publishes or
 * unpublishes a course in AI Tutor, this function calls Core's dedicated
 * publish/unpublish endpoints with the service key before the local DB is
 * updated. Failure here should surface to the caller — not silently swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setCoreCoursePublishState } from '../../src/services/eduaiClient.js';

const OFFERING_ID = 'core-cuid-1';
const SERVICE_KEY = 'test-service-key';

beforeEach(() => {
  process.env.EDUAI_API_KEY = SERVICE_KEY;
  process.env.EDUAI_BASE_URL = 'http://core.test/api';
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
});

describe('setCoreCoursePublishState', () => {
  it('throws when EDUAI_API_KEY is not configured', async () => {
    delete process.env.EDUAI_API_KEY;
    await expect(setCoreCoursePublishState(OFFERING_ID, true)).rejects.toThrow(
      'EDUAI_API_KEY not configured',
    );
  });

  it('calls PATCH /courses/:id/publish with the Bearer service key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: OFFERING_ID, isPublished: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await setCoreCoursePublishState(OFFERING_ID, true);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`http://core.test/api/courses/${OFFERING_ID}/publish`);
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['Authorization']).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('calls PATCH /courses/:id/unpublish when publish is false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ id: OFFERING_ID, isPublished: false }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await setCoreCoursePublishState(OFFERING_ID, false);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`http://core.test/api/courses/${OFFERING_ID}/unpublish`);
  });

  it('throws with status on a Core HTTP error so the AI Tutor route can propagate it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }));

    await expect(setCoreCoursePublishState(OFFERING_ID, true)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws with status 404 when Core reports course not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('COURSE_NOT_FOUND'),
    }));

    await expect(setCoreCoursePublishState(OFFERING_ID, true)).rejects.toMatchObject({
      status: 404,
    });
  });
});
