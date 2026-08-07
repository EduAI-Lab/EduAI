import { describe, it, expect } from 'vitest';
import {
  coreFacetWhere,
  coreFacets,
  coreStatusValue,
  coreTermKey,
  matchesCoreCourse,
} from '../../src/utils/courseSearch.js';

/** Core catalog course shape (see mapCourseOffering: name/code/term/year/isPublished). */
function course(overrides = {}) {
  return {
    id: 'core-1',
    name: 'Intro to Computing',
    code: 'COSC 111',
    term: 'W1',
    year: 2026,
    isPublished: true,
    ...overrides,
  };
}

describe('matchesCoreCourse', () => {
  it('matches on the course name', () => {
    expect(matchesCoreCourse(course(), 'computing')).toBe(true);
  });

  it('matches on the course code, not just the name', () => {
    expect(matchesCoreCourse(course(), 'cosc')).toBe(true);
  });

  it('matches a substring anywhere in the haystack', () => {
    expect(matchesCoreCourse(course(), 'tro to')).toBe(true);
  });

  it('is case-insensitive (caller lower-cases the query)', () => {
    expect(matchesCoreCourse(course({ name: 'ADVANCED ALGEBRA' }), 'algebra')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matchesCoreCourse(course(), 'biology')).toBe(false);
  });

  it('tolerates a null name and code rather than throwing', () => {
    expect(matchesCoreCourse({ id: 'x', name: null, code: null }, 'anything')).toBe(false);
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesCoreCourse(course(), '')).toBe(true);
  });
});

describe('coreTermKey', () => {
  it('emits the `term::year` shape buildTermFilterGroup uses', () => {
    expect(coreTermKey(course({ term: 'W2', year: 2025 }))).toBe('W2::2025');
  });

  it('trims the term so it matches courseTerm() on the client', () => {
    expect(coreTermKey(course({ term: '  W1  ', year: 2026 }))).toBe('W1::2026');
  });

  it('returns null when the term is missing', () => {
    expect(coreTermKey(course({ term: null }))).toBeNull();
  });

  it('returns null when the year is missing or not a number', () => {
    expect(coreTermKey(course({ year: null }))).toBeNull();
    expect(coreTermKey(course({ year: '2026' }))).toBeNull();
  });
});

describe('coreStatusValue', () => {
  it('maps isPublished true to published', () => {
    expect(coreStatusValue(course({ isPublished: true }))).toBe('published');
  });

  it('maps anything else to draft, including a missing flag', () => {
    expect(coreStatusValue(course({ isPublished: false }))).toBe('draft');
    expect(coreStatusValue({ id: 'x' })).toBe('draft');
  });
});

describe('coreFacetWhere', () => {
  const catalog = [
    course({ id: 'a', name: 'Intro to Computing', code: 'COSC 111', term: 'W1', year: 2026, isPublished: true }),
    course({ id: 'b', name: 'Data Structures', code: 'COSC 221', term: 'W2', year: 2026, isPublished: false }),
    course({ id: 'c', name: 'Linear Algebra', code: 'MATH 221', term: 'W1', year: 2026, isPublished: true }),
    course({ id: 'd', name: 'Organic Chemistry', code: 'CHEM 203', term: 'S1', year: 2025, isPublished: true }),
  ];

  it('returns null when no criterion is supplied, so the caller omits the filter', () => {
    expect(coreFacetWhere(catalog, {})).toBeNull();
    expect(coreFacetWhere(catalog, { search: '   ', terms: [], statuses: [] })).toBeNull();
  });

  it('filters by search across name and code', () => {
    expect(coreFacetWhere(catalog, { search: 'cosc' })).toEqual({
      coreOfferingId: { in: ['a', 'b'] },
    });
  });

  it('ORs multiple values within the term dimension', () => {
    expect(coreFacetWhere(catalog, { terms: ['W2::2026', 'S1::2025'] })).toEqual({
      coreOfferingId: { in: ['b', 'd'] },
    });
  });

  it('filters by status', () => {
    expect(coreFacetWhere(catalog, { statuses: ['draft'] })).toEqual({
      coreOfferingId: { in: ['b'] },
    });
  });

  it('ANDs across dimensions', () => {
    expect(coreFacetWhere(catalog, { search: 'cosc', terms: ['W1::2026'] })).toEqual({
      coreOfferingId: { in: ['a'] },
    });
    expect(coreFacetWhere(catalog, { search: 'cosc', statuses: ['draft'] })).toEqual({
      coreOfferingId: { in: ['b'] },
    });
  });

  it('yields an empty id set when nothing matches — not a null', () => {
    expect(coreFacetWhere(catalog, { search: 'astrophysics' })).toEqual({
      coreOfferingId: { in: [] },
    });
  });

  it('yields an empty id set on an empty catalog, preserving fail-closed behaviour', () => {
    expect(coreFacetWhere([], { search: 'cosc' })).toEqual({ coreOfferingId: { in: [] } });
  });

  it('skips catalog entries without a usable id', () => {
    expect(coreFacetWhere([null, { id: 42, name: 'x' }, ...catalog], { search: 'linear' })).toEqual({
      coreOfferingId: { in: ['c'] },
    });
  });
});

describe('coreFacets', () => {
  it('returns distinct terms, most recent first', () => {
    const facets = coreFacets([
      course({ id: 'a', term: 'W1', year: 2025 }),
      course({ id: 'b', term: 'W2', year: 2026 }),
      course({ id: 'c', term: 'W1', year: 2026 }),
      course({ id: 'd', term: 'W1', year: 2026 }), // duplicate
    ]);
    expect(facets.terms).toEqual(['W2::2026', 'W1::2026', 'W1::2025']);
  });

  it('orders terms within a year by the shared rank (S1 < S2 < W1 < W2)', () => {
    const facets = coreFacets([
      course({ id: 'a', term: 'S1', year: 2026 }),
      course({ id: 'b', term: 'W2', year: 2026 }),
      course({ id: 'c', term: 'S2', year: 2026 }),
      course({ id: 'd', term: 'W1', year: 2026 }),
    ]);
    expect(facets.terms).toEqual(['W2::2026', 'W1::2026', 'S2::2026', 'S1::2026']);
  });

  it('omits courses with no resolvable term', () => {
    const facets = coreFacets([course({ id: 'a', term: null }), course({ id: 'b', term: 'W1', year: 2026 })]);
    expect(facets.terms).toEqual(['W1::2026']);
  });

  it('lists only the statuses actually present, published first', () => {
    expect(coreFacets([course({ isPublished: true })]).statuses).toEqual(['published']);
    expect(coreFacets([course({ isPublished: false })]).statuses).toEqual(['draft']);
    expect(
      coreFacets([course({ id: 'a', isPublished: false }), course({ id: 'b', isPublished: true })]).statuses,
    ).toEqual(['published', 'draft']);
  });

  it('returns empty facets for an empty catalog', () => {
    expect(coreFacets([])).toEqual({ terms: [], statuses: [] });
  });
});
