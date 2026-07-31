import { describe, it, expect } from 'vitest';
import {
  parsePaginationParams,
  paginated,
  PaginationError,
  MAX_PAGE_SIZE,
  MAX_PAGE,
} from '../../src/utils/pagination.js';

/** Minimal Express-request stub — only `query` is read by the helper. */
const reqWith = (query) => ({ query });

describe('parsePaginationParams', () => {
  describe('required mode (default)', () => {
    it('parses valid page/pageSize into skip/take', () => {
      const p = parsePaginationParams(reqWith({ page: '3', pageSize: '10' }));
      expect(p).toEqual({ page: 3, pageSize: 10, skip: 20, take: 10 });
    });

    it('throws PAGINATION_REQUIRED when page is absent', () => {
      try {
        parsePaginationParams(reqWith({ pageSize: '10' }));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PaginationError);
        expect(e.status).toBe(400);
        expect(e.code).toBe('PAGINATION_REQUIRED');
      }
    });

    it('throws PAGINATION_REQUIRED when pageSize is absent', () => {
      expect(() => parsePaginationParams(reqWith({ page: '1' }))).toThrow(PaginationError);
    });

    it('throws PAGINATION_REQUIRED when params are empty strings', () => {
      expect(() => parsePaginationParams(reqWith({ page: '', pageSize: '' }))).toThrow(
        /required/,
      );
    });

    it('throws PAGINATION_INVALID when params are non-numeric', () => {
      try {
        parsePaginationParams(reqWith({ page: 'abc', pageSize: '10' }));
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PaginationError);
        expect(e.code).toBe('PAGINATION_INVALID');
      }
    });
  });

  describe('optional mode', () => {
    it('falls back to page 1 at defaultPageSize when absent', () => {
      const p = parsePaginationParams(reqWith({}), { required: false, defaultPageSize: 200 });
      expect(p).toEqual({ page: 1, pageSize: 200, skip: 0, take: 200 });
    });

    it('still honours explicit params', () => {
      const p = parsePaginationParams(reqWith({ page: '2', pageSize: '50' }), {
        required: false,
      });
      expect(p).toEqual({ page: 2, pageSize: 50, skip: 50, take: 50 });
    });

    // Modes must agree on malformed input — previously `page=abc` was a 400 in
    // required mode but silently became page 1 here.
    it('throws PAGINATION_INVALID for a malformed page, same as required mode', () => {
      try {
        parsePaginationParams(reqWith({ page: 'abc' }), { required: false });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PaginationError);
        expect(e.status).toBe(400);
        expect(e.code).toBe('PAGINATION_INVALID');
      }
    });

    it('throws PAGINATION_INVALID for a malformed pageSize', () => {
      expect(() =>
        parsePaginationParams(reqWith({ pageSize: 'lots' }), { required: false }),
      ).toThrow(PaginationError);
    });

    it('treats an empty-string param as absent, not malformed', () => {
      const p = parsePaginationParams(reqWith({ page: '', pageSize: '' }), {
        required: false,
        defaultPageSize: 200,
      });
      expect(p).toEqual({ page: 1, pageSize: 200, skip: 0, take: 200 });
    });
  });

  describe('clamping', () => {
    it('clamps page below 1 up to 1', () => {
      const p = parsePaginationParams(reqWith({ page: '0', pageSize: '10' }));
      expect(p.page).toBe(1);
      expect(p.skip).toBe(0);
    });

    it('clamps negative page up to 1', () => {
      const p = parsePaginationParams(reqWith({ page: '-5', pageSize: '10' }));
      expect(p.page).toBe(1);
    });

    it('clamps pageSize above MAX_PAGE_SIZE down to the ceiling', () => {
      const p = parsePaginationParams(reqWith({ page: '1', pageSize: '9999' }));
      expect(p.pageSize).toBe(MAX_PAGE_SIZE);
      expect(p.take).toBe(MAX_PAGE_SIZE);
    });

    it('clamps pageSize below 1 up to 1', () => {
      const p = parsePaginationParams(reqWith({ page: '1', pageSize: '0' }));
      expect(p.pageSize).toBe(1);
    });

    it('respects a custom maxPageSize', () => {
      const p = parsePaginationParams(reqWith({ page: '1', pageSize: '500' }), {
        maxPageSize: 100,
      });
      expect(p.pageSize).toBe(100);
    });

    it('floors fractional values', () => {
      const p = parsePaginationParams(reqWith({ page: '2.9', pageSize: '10.7' }));
      expect(p.page).toBe(2);
      expect(p.pageSize).toBe(10);
    });

    it('clamps page above MAX_PAGE down to the ceiling', () => {
      const p = parsePaginationParams(reqWith({ page: '99999999', pageSize: '10' }));
      expect(p.page).toBe(MAX_PAGE);
    });

    // A huge finite page previously produced an offset past MAX_SAFE_INTEGER.
    it('keeps skip a safe integer for an absurdly large page', () => {
      const p = parsePaginationParams(reqWith({ page: '1e18', pageSize: '200' }));
      expect(p.page).toBe(MAX_PAGE);
      expect(p.skip).toBe((MAX_PAGE - 1) * 200);
      expect(Number.isSafeInteger(p.skip)).toBe(true);
    });

    it('rejects Infinity rather than clamping it', () => {
      expect(() => parsePaginationParams(reqWith({ page: 'Infinity', pageSize: '10' }))).toThrow(
        PaginationError,
      );
    });
  });
});

describe('paginated', () => {
  it('wraps rows in the envelope with the total and page params', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(paginated(rows, 57, { page: 2, pageSize: 25 })).toEqual({
      data: rows,
      total: 57,
      page: 2,
      pageSize: 25,
    });
  });

  it('carries an empty page through unchanged', () => {
    expect(paginated([], 0, { page: 1, pageSize: 25 })).toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });
});
