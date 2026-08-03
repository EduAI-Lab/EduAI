/**
 * #1208: the instructor list searches and filters server-side.
 *
 * The defect being fixed: `CourseListView` used to filter `loaderData.courses` —
 * a single page — so a course matching on page 2 rendered "No courses match"
 * while the pager below reported a non-zero total.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';

const listCourses = vi.fn();
const listCourseFacets = vi.fn();

vi.mock('~/lib/api', () => {
  const api = {
    listCourses: (...a: unknown[]) => listCourses(...a),
    listCourseFacets: (...a: unknown[]) => listCourseFacets(...a),
  };
  return { default: api, api };
});

vi.mock('~/lib/client-auth', () => ({
  requireClientUser: vi.fn().mockResolvedValue({ id: 'u1', name: 'Prof', role: 'INSTRUCTOR' }),
}));

import InstructorHome, { clientLoader } from '~/routes/instructor';
import { clearCourseFacetsCache } from '~/lib/course-facets';
import { ShellBreadcrumbProvider } from '~/components/layout/ShellBreadcrumbContext';
import type { Route } from '../../routes/+types/instructor';
import type { Course } from '~/lib/types';

const course = (over: Partial<Course> = {}): Partial<Course> => ({
  id: 1,
  title: 'Linear Algebra',
  code: 'MATH 221',
  isPublished: true,
  ...over,
});

const runLoader = (url: string) =>
  clientLoader({ request: new Request(url) } as Route.ClientLoaderArgs);

describe('instructor clientLoader — filter threading', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue({
      data: [course()],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    listCourseFacets.mockReset().mockResolvedValue({
      terms: ['W1::2026'],
      statuses: ['published', 'draft'],
      progress: [],
      coreUnavailable: false,
    });
    // Facets are cached for the SPA session so the loader doesn't re-walk Core's
    // catalog on every keystroke; drop it so each test starts from a cold fetch.
    clearCourseFacetsCache();
  });

  it('sends no filters for a bare URL', async () => {
    await runLoader('http://x/instructor');

    expect(listCourses).toHaveBeenCalledWith({
      page: 1,
      search: undefined,
      term: [],
      status: [],
    });
  });

  it('threads search, term and status through to the server', async () => {
    // Enough rows that page 2 exists, or the past-the-end guard would redirect.
    listCourses.mockResolvedValue({ data: [course()], total: 400, page: 2, pageSize: 200 });

    await runLoader('http://x/instructor?search=algebra&term=W1::2026&status=draft&page=2');

    expect(listCourses).toHaveBeenCalledWith({
      page: 2,
      search: 'algebra',
      term: ['W1::2026'],
      status: ['draft'],
    });
  });

  it('fetches facets alongside the page so options span the whole set', async () => {
    const data = await runLoader('http://x/instructor');

    expect(listCourseFacets).toHaveBeenCalledTimes(1);
    expect(data.facets.terms).toEqual(['W1::2026']);
  });

  it('returns the server total so the pager reflects the filtered set', async () => {
    listCourses.mockResolvedValue({ data: [course()], total: 42, page: 1, pageSize: 200 });

    const data = await runLoader('http://x/instructor?search=a');

    expect(data.total).toBe(42);
  });

  it('redirects past-the-end pages while preserving every filter param', async () => {
    listCourses.mockResolvedValue({ data: [], total: 1, page: 9, pageSize: 200 });

    // #1162's guard must not drop the filters on the way through.
    await expect(
      runLoader('http://x/instructor?page=9&search=algebra&term=W1::2026&status=draft'),
    ).rejects.toMatchObject({ status: 302 });

    const thrown = await runLoader(
      'http://x/instructor?page=9&search=algebra&term=W1::2026&status=draft',
    ).catch((e: Response) => e);
    const location = (thrown as Response).headers.get('Location') ?? '';
    expect(location).toContain('page=1');
    expect(location).toContain('search=algebra');
    expect(location).toContain('status=draft');
    expect(location).toContain('term=');
  });
});

describe('InstructorHome — controlled list', () => {
  let currentSearch = '';

  function renderPage(overrides: Record<string, unknown> = {}, entry = '/instructor') {
    currentSearch = '';
    const props = {
      loaderData: {
        courses: [course()],
        total: 1,
        page: 1,
        pageSize: 200,
        selection: { page: 1, search: '', filters: { term: [], status: [], progress: [] } },
        facets: { terms: [], statuses: [], progress: [] },
        ...overrides,
      },
    } as unknown as Route.ComponentProps;

    function Harness() {
      currentSearch = useLocation().search;
      return (
        <ShellBreadcrumbProvider>
          <InstructorHome {...props} />
        </ShellBreadcrumbProvider>
      );
    }

    const router = createMemoryRouter([{ path: '/instructor', element: <Harness /> }], {
      initialEntries: [entry],
    });
    return render(<RouterProvider router={router} />);
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-filter rows the server already matched', () => {
    // The row does not match the active query locally — it matched server-side
    // (e.g. on a field the card doesn't render). Re-filtering would drop it.
    renderPage({
      selection: {
        page: 1,
        search: 'organic chemistry',
        filters: { term: [], status: [], progress: [] },
      },
    });

    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
  });

  it('pushes a typed search into the URL and resets the page', async () => {
    renderPage({}, '/instructor?page=3');

    fireEvent.change(screen.getByLabelText('Search courses'), { target: { value: 'algebra' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(currentSearch).toContain('search=algebra');
    expect(currentSearch).not.toContain('page=');
  });

  it('reports the server total rather than the page length', () => {
    renderPage({
      total: 137,
      selection: { page: 1, search: 'a', filters: { term: [], status: [], progress: [] } },
    });

    expect(screen.getByText(/137 courses found/)).toBeInTheDocument();
  });
});
