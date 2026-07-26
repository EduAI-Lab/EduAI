/**
 * Unit tests for the client-side page walker (#1044).
 *
 * Every QM list endpoint now returns a bounded window, so whole-set readers walk
 * pages. These cover the walk's termination rules — the failure mode to avoid is
 * an unbounded request loop when the server's `total` and page contents disagree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();

vi.mock('@/services/api', () => ({
  default: { get: (...args: unknown[]) => get(...args) },
}));

const { fetchAllPages, MAX_PAGE_SIZE } = await import('@/services/pagination');

/** Builds a server response for `page` out of a fixed backing set. */
const pageFrom = <T,>(rows: T[], page: number, pageSize: number) => ({
  data: {
    success: true,
    data: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  },
});

afterEach(() => {
  get.mockReset();
});

describe('fetchAllPages', () => {
  it('returns a single page without a second request', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    get.mockImplementation(() => Promise.resolve(pageFrom(rows, 1, 10)));

    expect(await fetchAllPages('/api/thing', {}, 10)).toEqual(rows);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('walks every page and concatenates in order', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
    get.mockImplementation((_path, config) =>
      Promise.resolve(pageFrom(rows, config.params.page, 10)),
    );

    const result = await fetchAllPages<{ id: number }>('/api/thing', {}, 10);

    expect(result).toEqual(rows);
    // 10 + 10 + 5 — stops on the short third page.
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('stops on an exact-multiple boundary once total is covered', async () => {
    // 20 rows at pageSize 10 means no short page; only the `total` check ends it.
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
    get.mockImplementation((_path, config) =>
      Promise.resolve(pageFrom(rows, config.params.page, 10)),
    );

    expect(await fetchAllPages('/api/thing', {}, 10)).toHaveLength(20);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('sends page/pageSize and merges extra params into every request', async () => {
    get.mockImplementation(() => Promise.resolve(pageFrom([{ id: 1 }], 1, 5)));

    await fetchAllPages('/api/thing', { courseId: 7 }, 5);

    expect(get).toHaveBeenCalledWith('/api/thing', {
      params: { courseId: 7, page: 1, pageSize: 5 },
    });
  });

  it('defaults to the server-clamped max page size', async () => {
    get.mockImplementation(() => Promise.resolve(pageFrom([{ id: 1 }], 1, MAX_PAGE_SIZE)));

    await fetchAllPages('/api/thing');

    expect(get).toHaveBeenCalledWith('/api/thing', {
      params: { page: 1, pageSize: MAX_PAGE_SIZE },
    });
  });

  it('terminates on an empty page even when total overstates the set', async () => {
    // A set that shrinks mid-walk leaves `total` permanently out of reach; the
    // empty-page exit is what stops this from looping forever.
    get.mockImplementation((_path, config) =>
      Promise.resolve({
        data: { success: true, data: config.params.page === 1 ? [{ id: 1 }] : [], total: 999, page: config.params.page, pageSize: 1 },
      }),
    );

    expect(await fetchAllPages('/api/thing', {}, 1)).toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('hard-caps the walk when the server never returns a short page', async () => {
    // Pathological server: always a full page, always an unreachable total. The
    // page cap is the backstop that keeps this from hanging the caller.
    get.mockImplementation((_path, config) =>
      Promise.resolve({
        data: { success: true, data: [{ id: config.params.page }], total: 1e9, page: config.params.page, pageSize: 1 },
      }),
    );

    const result = await fetchAllPages('/api/thing', {}, 1);

    expect(get.mock.calls.length).toBeLessThanOrEqual(1000);
    expect(result).toHaveLength(get.mock.calls.length);
  });

  it('tolerates a response with no envelope metadata', async () => {
    get.mockImplementation(() => Promise.resolve({ data: { success: true, data: [{ id: 1 }] } }));

    expect(await fetchAllPages('/api/thing', {}, 10)).toEqual([{ id: 1 }]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when the first page is empty', async () => {
    get.mockImplementation(() => Promise.resolve(pageFrom([], 1, 10)));

    expect(await fetchAllPages('/api/thing', {}, 10)).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('propagates a request failure rather than returning a partial set', async () => {
    get.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(fetchAllPages('/api/thing')).rejects.toThrow('boom');
  });
});
