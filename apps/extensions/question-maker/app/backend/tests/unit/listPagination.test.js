import { describe, it, expect } from 'vitest';
import {
  parseLimitOffset,
  escapeLikeLiteral,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from '../../src/utils/listPagination.js';

describe('parseLimitOffset (#1040)', () => {
  it('defaults limit/offset when query is empty', () => {
    expect(parseLimitOffset({})).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
  });

  it('parses valid limit and offset', () => {
    expect(parseLimitOffset({ limit: '25', offset: '50' })).toEqual({
      limit: 25,
      offset: 50,
    });
  });

  it('clamps limit to maxLimit', () => {
    expect(parseLimitOffset({ limit: String(MAX_LIST_LIMIT + 500) })).toEqual({
      limit: MAX_LIST_LIMIT,
      offset: 0,
    });
  });

  it('rejects non-positive / NaN limit and offset', () => {
    expect(parseLimitOffset({ limit: '0', offset: '-1' })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
    expect(parseLimitOffset({ limit: 'nope', offset: 'x' })).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
    });
  });

  it('escapes LIKE wildcards instead of stripping them, so the literal text is preserved', () => {
    expect(escapeLikeLiteral('100%_done')).toBe('100\\%\\_done');
  });

  it('escapes a literal backslash before adding wildcard escapes, so it is not misread as escaping them', () => {
    expect(escapeLikeLiteral('a\\%b')).toBe('a\\\\\\%b');
  });
});
