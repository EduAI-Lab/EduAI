/**
 * Unit tests for `listCoreAdminUsers` id chunking (#1129 review).
 *
 * Core caps the `?ids=` lookup at `CORE_PAGE_SIZE` (200) per request. The
 * enrollment id->name map in the admin routes passes every enrolled user's id
 * at once, so a course with more than 200 enrolled users must be chunked —
 * otherwise Core rejects the request with IDS_TOO_MANY and the whole map is lost.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCoreAdminUsers } from '../../src/services/eduaiClient.js';

beforeEach(() => {
  process.env.EDUAI_BASE_URL = 'http://core.test/api';
});

afterEach(() => {
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockUsersResponse(dataFor) {
  return vi.fn((url) => {
    const ids = new URLSearchParams(url.split('?')[1]).get('ids');
    const data = dataFor(ids?.split(',') ?? []);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data, total: data.length, page: 1, pageSize: data.length }),
    });
  });
}

describe('listCoreAdminUsers (ids)', () => {
  it('throws 401 without a session cookie', async () => {
    await expect(listCoreAdminUsers('', { ids: ['u1'] })).rejects.toMatchObject({ status: 401 });
  });

  it('returns an empty envelope for an empty id set without hitting the network', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await listCoreAdminUsers('cookie=abc', { ids: [] });

    expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('chunks more than CORE_PAGE_SIZE ids into separate requests and combines the envelopes', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const mockFetch = mockUsersResponse((chunkIds) =>
      chunkIds.map((id) => ({ id, name: id, email: `${id}@t.io` })),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await listCoreAdminUsers('cookie=abc', { ids });

    // 450 ids / 200 per request => 3 chunks, none over the cap.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (const [url] of mockFetch.mock.calls) {
      const sent = new URLSearchParams(url.split('?')[1]).get('ids').split(',');
      expect(sent.length).toBeLessThanOrEqual(200);
    }
    expect(result.data).toHaveLength(450);
    expect(result.total).toBe(450);
    expect(result.data.map((u) => u.id)).toEqual(ids);
  });

  it('dedupes ids before chunking', async () => {
    const ids = [...Array.from({ length: 200 }, (_, i) => `u${i}`), 'u0', 'u1', 'u2'];
    const mockFetch = mockUsersResponse((chunkIds) =>
      chunkIds.map((id) => ({ id, name: id, email: `${id}@t.io` })),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await listCoreAdminUsers('cookie=abc', { ids });

    // 200 unique ids fit in a single chunk; the duplicates do not spill a 2nd request.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(200);
  });

  // #1173 review: the admin enrollments route bounds its enrollment sync but
  // used to call this unbounded, so a hung Core kept the promised local-mirror
  // fallback from ever running. Both the `ids` lookup and the paged lookup
  // must forward the caller's signal to the underlying fetch.
  it('forwards options.signal to fetch so a hung Core lookup can be bounded', async () => {
    const mockFetch = mockUsersResponse(() => []);
    vi.stubGlobal('fetch', mockFetch);
    const signal = AbortSignal.timeout(3_000);

    await listCoreAdminUsers('cookie=abc', { ids: ['u1'], signal });
    await listCoreAdminUsers('cookie=abc', { role: 'STUDENT', signal });

    for (const [, options] of mockFetch.mock.calls) {
      expect(options.signal).toBe(signal);
    }
  });
});
