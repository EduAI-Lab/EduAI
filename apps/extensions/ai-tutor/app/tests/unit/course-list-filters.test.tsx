/**
 * URL plumbing for the server-filtered course lists (#1208).
 *
 * These pin the behaviour the loader depends on: filters live in the query
 * string (so they reach the server), and any change resets `page` (so a narrowed
 * result set can't strand the user on a page that no longer exists).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';

import {
  hasActiveCourseFilters,
  readCourseListSelection,
  useCourseListFilters,
} from '~/lib/course-list-filters';

describe('readCourseListSelection', () => {
  const read = (search: string) => readCourseListSelection(new URL(`http://x/instructor${search}`));

  it('defaults to page 1 with no search or filters', () => {
    expect(read('')).toEqual({
      page: 1,
      search: '',
      filters: { term: [], status: [], progress: [] },
    });
  });

  it('reads the page number', () => {
    expect(read('?page=3').page).toBe(3);
  });

  it('falls back to page 1 for a non-numeric or non-positive page', () => {
    expect(read('?page=abc').page).toBe(1);
    expect(read('?page=0').page).toBe(1);
    expect(read('?page=-2').page).toBe(1);
  });

  it('trims the search', () => {
    expect(read('?search=%20cosc%20').search).toBe('cosc');
  });

  it('collects repeated filter values', () => {
    expect(read('?term=W1::2026&term=W2::2025').filters.term).toEqual(['W1::2026', 'W2::2025']);
  });

  it('reads each dimension independently', () => {
    const s = read('?status=draft&progress=completed&term=W1::2026');
    expect(s.filters).toEqual({
      term: ['W1::2026'],
      status: ['draft'],
      progress: ['completed'],
    });
  });
});

describe('hasActiveCourseFilters', () => {
  const base = { page: 1, search: '', filters: { term: [], status: [], progress: [] } };

  it('is false with nothing applied', () => {
    expect(hasActiveCourseFilters(base)).toBe(false);
  });

  it('is true with a search', () => {
    expect(hasActiveCourseFilters({ ...base, search: 'cosc' })).toBe(true);
  });

  it('is true with any filter dimension set', () => {
    expect(
      hasActiveCourseFilters({ ...base, filters: { ...base.filters, progress: ['completed'] } }),
    ).toBe(true);
  });
});

describe('useCourseListFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mount the hook inside a real router, deriving `selection` from the live URL
   * exactly as the loader does. Without that round-trip the hook would be fed a
   * frozen selection that disagrees with the URL it just wrote, and the
   * URL→input sync would fight every assertion.
   */
  function mount(initialEntry: string) {
    const api: {
      current: ReturnType<typeof useCourseListFilters> | null;
      search: string;
    } = { current: null, search: '' };

    function Harness() {
      const location = useLocation();
      api.search = location.search;
      const selection = readCourseListSelection(new URL(`http://x/instructor${location.search}`));
      api.current = useCourseListFilters(selection);
      return null;
    }

    const router = createMemoryRouter([{ path: '/instructor', element: <Harness /> }], {
      initialEntries: [initialEntry],
    });
    render(<RouterProvider router={router} />);
    return api;
  }

  const flush = async () => {
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
  };

  it('writes a debounced search into the URL and drops page', async () => {
    const h = mount('/instructor?page=4');

    act(() => {
      h.current!.setSearchDraft('algebra');
    });
    // Not yet — the debounce is what stops a navigation per keystroke.
    expect(h.search).not.toContain('search=algebra');

    await flush();

    expect(h.search).toContain('search=algebra');
    // Results shift under a new query, so page 4 would likely no longer exist.
    expect(h.search).not.toContain('page=');
  });

  it('removes the search param entirely when cleared', async () => {
    const h = mount('/instructor?search=algebra');

    act(() => {
      h.current!.setSearchDraft('');
    });
    await flush();

    expect(h.search).not.toContain('search=');
  });

  it('applies a filter immediately and drops page', () => {
    const h = mount('/instructor?page=4');

    act(() => {
      h.current!.setFilter('status', ['draft']);
    });

    expect(h.search).toContain('status=draft');
    expect(h.search).not.toContain('page=');
  });

  it('writes one param per value for a multi-select', () => {
    const h = mount('/instructor');

    act(() => {
      h.current!.setFilter('term', ['W1::2026', 'W2::2025']);
    });

    expect(h.search.match(/term=/g)).toHaveLength(2);
  });

  it('removes a filter param when its selection empties', () => {
    const h = mount('/instructor?status=draft');

    act(() => {
      h.current!.setFilter('status', []);
    });

    expect(h.search).not.toContain('status=');
  });

  it('ignores an unknown group id rather than writing a junk param', () => {
    const h = mount('/instructor');

    act(() => {
      h.current!.setFilter('department', ['COSC']);
    });

    expect(h.search).not.toContain('department');
  });

  it('clearAll drops every dimension and the page', async () => {
    const h = mount('/instructor?page=4&search=algebra&term=W1::2026&status=draft');

    act(() => {
      h.current!.clearAll();
    });
    await flush();

    for (const fragment of ['search=', 'term=', 'status=', 'progress=', 'page=']) {
      expect(h.search, fragment).not.toContain(fragment);
    }
  });

  it('goToPage sets page while preserving the filters', () => {
    const h = mount('/instructor?status=draft');

    act(() => {
      h.current!.goToPage(2);
    });

    expect(h.search).toContain('page=2');
    expect(h.search).toContain('status=draft');
  });

  it('syncs the input when the URL changes from elsewhere (back/forward)', async () => {
    const h = mount('/instructor?search=algebra');
    expect(h.current!.searchDraft).toBe('algebra');

    act(() => {
      h.current!.setFilter('status', ['draft']);
    });
    await flush();

    // The unrelated navigation must not wipe the query the user is filtering on.
    expect(h.current!.searchDraft).toBe('algebra');
    expect(h.search).toContain('search=algebra');
  });
});
