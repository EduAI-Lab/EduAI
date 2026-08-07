import { describe, it, expect } from 'vitest';
import {
  parsePaginationParams,
  parseSearchParam,
  parseFilterParam,
  paginated,
  searchWhere,
  activitySearchWhere,
  PaginationError,
  MAX_PAGE_SIZE,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  MAX_FILTER_VALUES,
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

describe('parseSearchParam', () => {
  it('returns undefined when the param is absent, so callers omit the filter entirely', () => {
    expect(parseSearchParam(reqWith({}))).toBeUndefined();
  });

  it('treats an empty or whitespace-only term as absent', () => {
    expect(parseSearchParam(reqWith({ search: '' }))).toBeUndefined();
    expect(parseSearchParam(reqWith({ search: '   ' }))).toBeUndefined();
    expect(parseSearchParam(reqWith({ search: '\t\n ' }))).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    expect(parseSearchParam(reqWith({ search: '  graphs  ' }))).toBe('graphs');
  });

  it('collapses internal whitespace so spacing variants are one query (#1207)', () => {
    expect(parseSearchParam(reqWith({ search: 'binary   search   trees' }))).toBe(
      'binary search trees',
    );
  });

  it('preserves single-spaced inner whitespace and case', () => {
    expect(parseSearchParam(reqWith({ search: 'Intro To Computing' }))).toBe('Intro To Computing');
  });

  it('reads a custom param name', () => {
    expect(parseSearchParam(reqWith({ q: 'algebra' }), { param: 'q' })).toBe('algebra');
  });

  it('throws SEARCH_INVALID when the param is repeated', () => {
    try {
      parseSearchParam(reqWith({ search: ['a', 'b'] }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect(e.code).toBe('SEARCH_INVALID');
      expect(e.status).toBe(400);
    }
  });

  it('throws SEARCH_TOO_LONG past MAX_SEARCH_LENGTH', () => {
    try {
      parseSearchParam(reqWith({ search: 'x'.repeat(MAX_SEARCH_LENGTH + 1) }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect(e.code).toBe('SEARCH_TOO_LONG');
      expect(e.status).toBe(400);
    }
  });

  it('accepts a query exactly at the limit', () => {
    const atLimit = 'x'.repeat(MAX_SEARCH_LENGTH);
    expect(parseSearchParam(reqWith({ search: atLimit }))).toBe(atLimit);
  });

  it('honours a caller-supplied maxLength', () => {
    expect(() => parseSearchParam(reqWith({ search: 'abcdef' }), { maxLength: 3 })).toThrow(
      PaginationError,
    );
    expect(parseSearchParam(reqWith({ search: 'abc' }), { maxLength: 3 })).toBe('abc');
  });
});

describe('parseFilterParam', () => {
  it('returns an empty array when the param is absent', () => {
    expect(parseFilterParam(reqWith({}), 'term')).toEqual([]);
  });

  it('wraps a single value', () => {
    expect(parseFilterParam(reqWith({ term: 'W1::2026' }), 'term')).toEqual(['W1::2026']);
  });

  it('keeps every value of a repeated param', () => {
    expect(parseFilterParam(reqWith({ term: ['W1::2026', 'W2::2025'] }), 'term')).toEqual([
      'W1::2026',
      'W2::2025',
    ]);
  });

  it('de-dupes and drops blanks', () => {
    expect(parseFilterParam(reqWith({ term: ['a', 'a', '', '  ', ' b '] }), 'term')).toEqual(['a', 'b']);
  });

  it('accepts values inside the allowed set', () => {
    expect(
      parseFilterParam(reqWith({ status: 'draft' }), 'status', { allowed: ['published', 'draft'] }),
    ).toEqual(['draft']);
  });

  it('throws FILTER_INVALID on a value outside the allowed set', () => {
    try {
      parseFilterParam(reqWith({ status: 'bogus' }), 'status', { allowed: ['published', 'draft'] });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect(e.code).toBe('FILTER_INVALID');
      expect(e.status).toBe(400);
    }
  });

  it('throws FILTER_TOO_MANY past MAX_FILTER_VALUES', () => {
    const many = Array.from({ length: MAX_FILTER_VALUES + 1 }, (_, i) => `v${i}`);
    try {
      parseFilterParam(reqWith({ term: many }), 'term');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect(e.code).toBe('FILTER_TOO_MANY');
    }
  });

  it('throws FILTER_INVALID on a non-string value', () => {
    try {
      parseFilterParam(reqWith({ term: [{ nested: true }] }), 'term');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PaginationError);
      expect(e.code).toBe('FILTER_INVALID');
    }
  });
});

describe('searchWhere (#1207)', () => {
  it('returns null with no term, so the caller skips the AND entirely', () => {
    expect(searchWhere(undefined, ['title'])).toBeNull();
    expect(searchWhere(null, ['title'])).toBeNull();
    expect(searchWhere('', ['title'])).toBeNull();
  });

  it('returns null when no fields are searchable', () => {
    expect(searchWhere('graphs', [])).toBeNull();
  });

  it('builds a case-insensitive contains across each field', () => {
    expect(searchWhere('graphs', ['title', 'description'])).toEqual({
      OR: [
        { title: { contains: 'graphs', mode: 'insensitive' } },
        { description: { contains: 'graphs', mode: 'insensitive' } },
      ],
    });
  });

  it('expands a dotted path into a nested relation filter', () => {
    expect(searchWhere('week 1', ['lesson.module.title'])).toEqual({
      OR: [
        {
          lesson: {
            module: { title: { contains: 'week 1', mode: 'insensitive' } },
          },
        },
      ],
    });
  });

  it('mixes plain fields and relation paths in one OR', () => {
    const where = searchWhere('x', ['title', 'lesson.title']);
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({ title: { contains: 'x', mode: 'insensitive' } });
    expect(where.OR[1]).toEqual({ lesson: { title: { contains: 'x', mode: 'insensitive' } } });
  });
});

/** Every JSON-path clause in an activity fragment, as `[path, term]` pairs. */
const jsonClauses = (where, unnest = (clause) => clause) =>
  where.OR.map(unnest)
    .filter((clause) => clause.config)
    .map((clause) => [clause.config.path.join('.'), clause.config.string_contains]);

describe('activitySearchWhere (#1207)', () => {
  it('returns null with no term', () => {
    expect(activitySearchWhere(undefined)).toBeNull();
    expect(activitySearchWhere(null)).toBeNull();
    expect(activitySearchWhere('')).toBeNull();
  });

  it('searches the legacy config.prompt as well as config.question', () => {
    // `mapActivity` reads `config.question ?? config.prompt ?? instructionsMd`,
    // so a row that only has `prompt` displays question text. Omitting the
    // clause made that text permanently unsearchable.
    const paths = new Set(jsonClauses(activitySearchWhere('heap')).map(([path]) => path));
    expect(paths).toEqual(new Set(['question', 'prompt']));
  });

  it('tries the same casing set against both JSON fields', () => {
    const clauses = jsonClauses(activitySearchWhere('spanning tree'));
    const byPath = (path) => clauses.filter(([p]) => p === path).map(([, term]) => term);
    // `string_contains` has no `mode`, so casing is brute-forced; both fields
    // have to get the same treatment or `prompt` matches strictly less.
    expect(byPath('prompt')).toEqual(byPath('question'));
    expect(byPath('question')).toEqual(
      expect.arrayContaining(['spanning tree', 'SPANNING TREE', 'Spanning tree', 'Spanning Tree']),
    );
  });

  it('still matches the real columns case-insensitively', () => {
    const where = activitySearchWhere('graphs');
    expect(where.OR).toContainEqual({ title: { contains: 'graphs', mode: 'insensitive' } });
    expect(where.OR).toContainEqual({
      instructionsMd: { contains: 'graphs', mode: 'insensitive' },
    });
  });

  it('nests every clause under the relation prefix', () => {
    const where = activitySearchWhere('heap', ['activity']);
    expect(where.OR.every((clause) => 'activity' in clause)).toBe(true);
    const paths = new Set(jsonClauses(where, (clause) => clause.activity).map(([path]) => path));
    expect(paths).toEqual(new Set(['question', 'prompt']));
  });
});
