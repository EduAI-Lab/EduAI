/**
 * Tests for the URL <-> list-query helpers behind the paged tree routes
 * (#1207). These decide what a bookmarked or hand-edited URL renders, and what
 * ordinal a drag on page 3 actually persists.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SEARCH_LENGTH,
  absoluteOrdinal,
  movedRowIndex,
  parseListUrlParams,
  redirectPastEnd,
} from '~/lib/list-params';

const req = (url: string) => new Request(url);

describe('parseListUrlParams', () => {
  it('defaults to page 1 with no search when the URL carries neither', () => {
    expect(parseListUrlParams(req('http://x/instructor/courses/1'))).toEqual({
      page: 1,
      search: '',
    });
  });

  it('reads page and search', () => {
    expect(parseListUrlParams(req('http://x/c?page=3&search=graphs'))).toEqual({
      page: 3,
      search: 'graphs',
    });
  });

  it('trims the search term', () => {
    expect(parseListUrlParams(req('http://x/c?search=%20%20graphs%20%20')).search).toBe('graphs');
  });

  // A junk page in a shared link should still render something useful rather
  // than throwing an error boundary at the recipient.
  it.each(['abc', '0', '-4', '', 'NaN'])('falls back to page 1 for ?page=%s', (value) => {
    expect(parseListUrlParams(req(`http://x/c?page=${value}`)).page).toBe(1);
  });

  it('floors a fractional page', () => {
    expect(parseListUrlParams(req('http://x/c?page=2.9')).page).toBe(2);
  });
});

describe('redirectPastEnd', () => {
  it('does nothing when the page is within range', () => {
    expect(() =>
      redirectPastEnd(req('http://x/c?page=2'), { page: 2, total: 60, pageSize: 25 }),
    ).not.toThrow();
  });

  it('does nothing on page 1 of an empty list', () => {
    expect(() =>
      redirectPastEnd(req('http://x/c?page=1'), { page: 1, total: 0, pageSize: 25 }),
    ).not.toThrow();
  });

  it('does nothing on the exact last page', () => {
    expect(() =>
      redirectPastEnd(req('http://x/c?page=3'), { page: 3, total: 51, pageSize: 25 }),
    ).not.toThrow();
  });

  // Redirecting rather than clamping keeps the address bar and the rendered
  // page from disagreeing.
  it('throws a redirect to the last page when the page is past the end', () => {
    try {
      redirectPastEnd(req('http://x/instructor/courses/1?page=40'), {
        page: 40,
        total: 60,
        pageSize: 25,
      });
      throw new Error('expected a redirect');
    } catch (thrown) {
      const response = thrown as Response;
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/instructor/courses/1?page=3');
    }
  });

  it('preserves the search term when redirecting', () => {
    try {
      redirectPastEnd(req('http://x/c?page=9&search=graphs'), {
        page: 9,
        total: 10,
        pageSize: 25,
      });
      throw new Error('expected a redirect');
    } catch (thrown) {
      const location = (thrown as Response).headers.get('location')!;
      expect(location).toContain('search=graphs');
      expect(location).toContain('page=1');
    }
  });
});

describe('absoluteOrdinal', () => {
  // This is what makes a drag on page 3 mean the right thing to the server.
  it('is the page-local index on page 1', () => {
    expect(absoluteOrdinal(1, 25, 0)).toBe(0);
    expect(absoluteOrdinal(1, 25, 7)).toBe(7);
  });

  it('offsets by the pages before it', () => {
    expect(absoluteOrdinal(3, 25, 0)).toBe(50);
    expect(absoluteOrdinal(3, 25, 4)).toBe(54);
  });

  it('tracks the page size', () => {
    expect(absoluteOrdinal(2, 10, 3)).toBe(13);
  });
});

describe('parseListUrlParams search cap', () => {
  // A term longer than the server's limit is a 400, which a loader can only
  // surface as the route error boundary — truncating keeps a pasted paragraph
  // from replacing the whole page.
  it('truncates an over-long search to the server limit', () => {
    const term = 'a'.repeat(MAX_SEARCH_LENGTH + 40);
    const { search } = parseListUrlParams(req(`http://x/c?search=${term}`));
    expect(search).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe('movedRowIndex', () => {
  // `SortableProvider` hands back `arrayMove(ids, oldIndex, newIndex)`, so every
  // row between source and target shifts by one. Naming the dragged row is what
  // decides which id gets persisted to `PATCH .../position`.
  it('names the dragged row on an upward drag', () => {
    // C dragged from index 2 to index 0.
    expect(movedRowIndex([12, 10, 11], [10, 11, 12])).toBe(0);
  });

  it('names the dragged row on a downward drag, not the row that shifted up', () => {
    // A dragged from index 0 to index 2: the first divergence is B, which only
    // shifted up. Naming it would persist a different order than was dropped.
    expect(movedRowIndex([11, 12, 10, 13], [10, 11, 12, 13])).toBe(2);
  });

  it('resolves an adjacent swap to the first index', () => {
    // "10 moved down one" and "11 moved up one" are the same two arrays and
    // persist the same order, so either answer is correct.
    expect(movedRowIndex([11, 10, 12], [10, 11, 12])).toBe(0);
  });

  it('returns -1 when nothing moved', () => {
    expect(movedRowIndex([10, 11, 12], [10, 11, 12])).toBe(-1);
  });
});
