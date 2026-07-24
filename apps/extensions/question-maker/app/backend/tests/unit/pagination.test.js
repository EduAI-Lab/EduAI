/**
 * Unit tests for the QM server-side pagination helper (#1044).
 *
 * Covers both parsing modes (required / optional), clamping, Sequelize-shaped
 * `limit`/`offset`, error codes, and the `{ success, data, total, page,
 * pageSize }` envelope.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_SIZE,
  PaginationError,
  paginated,
  parsePaginationParams,
} from '../../src/utils/pagination.js';

/** Minimal Express-request stub carrying only a query bag. */
const req = (query = {}) => ({ query });

describe('parsePaginationParams — required mode (default)', () => {
  it('parses valid page/pageSize into limit/offset', () => {
    const r = parsePaginationParams(req({ page: '3', pageSize: '20' }));
    expect(r).toEqual({ page: 3, pageSize: 20, limit: 20, offset: 40 });
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

describe('parsePaginationParams — optional mode', () => {
  it('defaults to page 1 at defaultPageSize when params absent', () => {
    const r = parsePaginationParams(req({}), { required: false });
    expect(r).toEqual({ page: 1, pageSize: 25, limit: 25, offset: 0 });
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
    expect(r).toEqual({ page: 2, pageSize: 30, limit: 30, offset: 30 });
  });

  it('falls back to defaults for non-numeric params (no throw)', () => {
    const r = parsePaginationParams(req({ page: 'x', pageSize: 'y' }), {
      required: false,
    });
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(25);
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
