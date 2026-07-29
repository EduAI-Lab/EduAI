/**
 * Unit tests for the QM server-side pagination helper (#1044).
 *
 * Covers both parsing modes (required / default), partial params, clamping,
 * Sequelize-shaped `limit`/`offset`, error codes, and the
 * `{ success, data, total, page, pageSize }` envelope.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_SIZE,
  PaginationError,
  pageOf,
  paginated,
  parsePaginationParams,
} from '../../src/utils/pagination.js';

/** Minimal Express-request stub carrying only a query bag. */
const req = (query = {}) => ({ query });

describe('parsePaginationParams — required mode (default)', () => {
  it('parses valid page/pageSize into limit/offset', () => {
    const r = parsePaginationParams(req({ page: '3', pageSize: '20' }));
    expect(r).toEqual({
      page: 3,
      pageSize: 20,
      limit: 20,
      offset: 40,
    });
  });

  it('throws PAGINATION_REQUIRED when page is missing', () => {
    try {
      parsePaginationParams(req({ pageSize: '20' }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaginationError);
      expect(err.status).toBe(400);
      expect(err.code).toBe('PAGINATION_REQUIRED');
    }
  });

  it('throws PAGINATION_REQUIRED when pageSize is missing', () => {
    expect(() => parsePaginationParams(req({ page: '1' }))).toThrow(PaginationError);
  });

  it('throws PAGINATION_REQUIRED when a param is an empty string', () => {
    expect(() => parsePaginationParams(req({ page: '', pageSize: '' }))).toThrow(
      /required/,
    );
  });

  it('throws PAGINATION_INVALID when a param is non-numeric', () => {
    try {
      parsePaginationParams(req({ page: 'abc', pageSize: '20' }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('PAGINATION_INVALID');
    }
  });
});

describe('parsePaginationParams — clamping', () => {
  it('clamps page below 1 up to 1 (offset 0)', () => {
    const r = parsePaginationParams(req({ page: '0', pageSize: '10' }));
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  it('clamps a negative page up to 1', () => {
    expect(parsePaginationParams(req({ page: '-5', pageSize: '10' })).page).toBe(1);
  });

  it('clamps pageSize above the max down to MAX_PAGE_SIZE', () => {
    const r = parsePaginationParams(req({ page: '1', pageSize: '9999' }));
    expect(r.pageSize).toBe(MAX_PAGE_SIZE);
    expect(r.limit).toBe(MAX_PAGE_SIZE);
  });

  it('clamps pageSize below 1 up to 1', () => {
    expect(parsePaginationParams(req({ page: '1', pageSize: '0' })).pageSize).toBe(1);
  });

  it('floors fractional page/pageSize', () => {
    const r = parsePaginationParams(req({ page: '2.9', pageSize: '10.7' }));
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(10);
  });

  it('honours a custom maxPageSize', () => {
    const r = parsePaginationParams(req({ page: '1', pageSize: '500' }), {
      maxPageSize: 50,
    });
    expect(r.pageSize).toBe(50);
  });
});

describe('parsePaginationParams — default mode', () => {
  it('defaults to page 1 at defaultPageSize when params absent', () => {
    const r = parsePaginationParams(req({}), { required: false });
    expect(r).toEqual({
      page: 1,
      pageSize: 25,
      limit: 25,
      offset: 0,
    });
  });

  it('honours a custom defaultPageSize', () => {
    const r = parsePaginationParams(req({}), {
      required: false,
      defaultPageSize: 200,
    });
    expect(r.pageSize).toBe(200);
  });

  it('still parses explicit params when provided', () => {
    const r = parsePaginationParams(req({ page: '2', pageSize: '30' }), {
      required: false,
    });
    expect(r).toEqual({
      page: 2,
      pageSize: 30,
      limit: 30,
      offset: 30,
    });
  });

  it('falls back to defaults for non-numeric params (no throw)', () => {
    const r = parsePaginationParams(req({ page: 'x', pageSize: 'y' }), {
      required: false,
    });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(25);
  });

  it('never returns an unbounded window, even with no params', () => {
    // The whole point of dropping the old whole-set escape hatch: every parse
    // yields a finite limit, so no endpoint can answer with every row.
    const r = parsePaginationParams(req({}), { required: false, defaultPageSize: 200 });
    expect(Number.isFinite(r.limit)).toBe(true);
    expect(r.limit).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});

describe('parsePaginationParams — partial params (only one of page/pageSize)', () => {
  it('rejects page-only in required mode', () => {
    try {
      parsePaginationParams(req({ page: '2' }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PaginationError);
      expect(err.code).toBe('PAGINATION_REQUIRED');
    }
  });

  it('rejects pageSize-only in required mode', () => {
    try {
      parsePaginationParams(req({ pageSize: '10' }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('PAGINATION_REQUIRED');
    }
  });

  it('honours page-only in default mode, defaulting pageSize', () => {
    const r = parsePaginationParams(req({ page: '3' }), {
      required: false,
      defaultPageSize: 10,
    });
    expect(r).toEqual({ page: 3, pageSize: 10, limit: 10, offset: 20 });
  });

  it('honours pageSize-only in default mode, defaulting page to 1', () => {
    const r = parsePaginationParams(req({ pageSize: '5' }), { required: false });
    expect(r).toEqual({ page: 1, pageSize: 5, limit: 5, offset: 0 });
  });

  it('treats an empty-string param as absent in default mode', () => {
    const r = parsePaginationParams(req({ page: '', pageSize: '5' }), {
      required: false,
    });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(5);
  });

  it('clamps a page-only value in default mode', () => {
    const r = parsePaginationParams(req({ page: '0' }), {
      required: false,
      defaultPageSize: 10,
    });
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });
});

describe('parsePaginationParams — page upper bound', () => {
  it('clamps an unbounded page so the offset stays in bigint range', () => {
    // Un-clamped this yields OFFSET 2e+22, which Postgres rejects — the client
    // would get a 500 instead of an empty page.
    const r = parsePaginationParams(req({ page: '1e20' }), { required: false });
    expect(Number.isSafeInteger(r.offset)).toBe(true);
    expect(r.page).toBe(1_000_000);
  });
});

describe('pageOf', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));

  it('bounds an unpaged caller to the default page instead of the whole set', () => {
    const p = parsePaginationParams(req({}), { required: false, defaultPageSize: 2 });
    expect(pageOf(rows, p)).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      total: 5,
      page: 1,
      pageSize: 2,
    });
  });

  it('returns the last partial page without padding', () => {
    const p = parsePaginationParams(req({ page: '3', pageSize: '2' }));
    expect(pageOf(rows, p)).toMatchObject({ data: [{ id: 5 }], total: 5, page: 3 });
  });

  it('returns an empty page past the end, keeping the true total', () => {
    // This is what lets a client walking pages stop cleanly rather than 404.
    const p = parsePaginationParams(req({ page: '9', pageSize: '2' }));
    expect(pageOf(rows, p)).toMatchObject({ data: [], total: 5, page: 9, pageSize: 2 });
  });

  it('slices the requested window and still reports the full total', () => {
    const p = parsePaginationParams(req({ page: '2', pageSize: '2' }), {
      required: false,
    });
    expect(pageOf(rows, p)).toEqual({
      success: true,
      data: [{ id: 3 }, { id: 4 }],
      total: 5,
      page: 2,
      pageSize: 2,
    });
  });

  it('reports an empty set as total 0 at the requested pageSize', () => {
    const p = parsePaginationParams(req({}), { required: false });
    expect(pageOf([], p)).toMatchObject({ data: [], total: 0, page: 1, pageSize: 25 });
  });
});

describe('paginated envelope', () => {
  it('wraps rows with success flag and pagination metadata', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(paginated(rows, 57, { page: 2, pageSize: 25 })).toEqual({
      success: true,
      data: rows,
      total: 57,
      page: 2,
      pageSize: 25,
    });
  });

  it('preserves an empty page as an empty array', () => {
    expect(paginated([], 0, { page: 1, pageSize: 25 })).toEqual({
      success: true,
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });
});
