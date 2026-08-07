/**
 * #1208: the student list filters server-side (search / term / progress) and
 * gained a pager it never had — without one, a filtered result set would still
 * truncate silently at the page bound.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router';

import StudentHome, { PROGRESS_FILTER } from '~/routes/student';
import type { Route } from '../../routes/+types/student';
import { AuthProvider } from '~/hooks/useLocalUser';
import { ShellBreadcrumbProvider } from '~/components/layout/ShellBreadcrumbContext';
import type { Course } from '~/lib/types';

function renderStudentHome(
  courses: Partial<Course>[],
  overrides: Record<string, unknown> = {},
  initialEntry = '/student',
) {
  const props = {
    loaderData: {
      courses,
      total: courses.length,
      page: 1,
      pageSize: 200,
      selection: { page: 1, search: '', filters: { term: [], status: [], progress: [] } },
      facets: { terms: [], statuses: [], progress: [] },
      ...overrides,
    },
  } as unknown as Route.ComponentProps;

  const router = createMemoryRouter(
    [
      {
        path: '/student',
        element: (
          <ShellBreadcrumbProvider>
            <StudentHome {...props} />
          </ShellBreadcrumbProvider>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );

  return render(
    <AuthProvider initialUser={{ id: 'u1', name: 'User', role: 'STUDENT' }}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

const course = (over: Partial<Course> = {}): Partial<Course> => ({
  id: 1,
  title: 'Linear Algebra',
  code: 'MATH 221',
  isPublished: true,
  ...over,
});

describe('StudentHome — server-side filters (#1208)', () => {
  it('renders a pager driven by the server total', () => {
    renderStudentHome([course()], { total: 450, pageSize: 200, page: 1 });

    // 450 across 200-course pages is 3 pages; before #1208 this route rendered
    // no pager at all and silently showed only the first page.
    expect(screen.getByText(/450/)).toBeInTheDocument();
  });

  it('does not re-filter the page the server already filtered', () => {
    // A completed course while `?progress=not-started` is selected: the server
    // is the authority, so the row must still render. If the view re-applied
    // PROGRESS_FILTER locally it would disappear.
    renderStudentHome(
      [course({ progress: { completed: 4, total: 4, percentage: 100 } })],
      {
        selection: {
          page: 1,
          search: '',
          filters: { term: [], status: [], progress: ['not-started'] },
        },
        facets: { terms: [], statuses: [], progress: ['not-started', 'in-progress', 'completed'] },
      },
    );

    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
  });

  it('does not re-filter on a search the page rows do not match', () => {
    renderStudentHome([course()], {
      selection: {
        page: 1,
        search: 'organic chemistry',
        filters: { term: [], status: [], progress: [] },
      },
    });

    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
  });

  it('seeds the search box from the URL selection', () => {
    renderStudentHome([course()], {
      selection: { page: 1, search: 'algebra', filters: { term: [], status: [], progress: [] } },
    });

    expect(screen.getByLabelText('Search courses')).toHaveValue('algebra');
  });
});

/**
 * Drift guard. `PROGRESS_FILTER.getValue` is the definition of record for these
 * buckets, but `?progress=` is applied by `progressBucket` on the server. The
 * mirrored cases live in `server/tests/integration/progressCalculationBatch.test.js`
 * — if the two ever disagree, the dropdown would label a course differently from
 * the filter that selected it.
 */
describe('PROGRESS_FILTER bucketing matches the server contract', () => {
  const withProgress = (completed: number, total: number) =>
    ({ progress: { completed, total, percentage: total ? (completed / total) * 100 : 0 } }) as Course;

  it('yields null when the course has no published activities', () => {
    expect(PROGRESS_FILTER.getValue(withProgress(0, 0))).toBeNull();
  });

  it('yields null when the course carries no progress at all', () => {
    expect(PROGRESS_FILTER.getValue({} as Course)).toBeNull();
  });

  it('buckets an untouched course as not-started', () => {
    expect(PROGRESS_FILTER.getValue(withProgress(0, 3))).toBe('not-started');
  });

  it('buckets a partly-done course as in-progress', () => {
    expect(PROGRESS_FILTER.getValue(withProgress(1, 3))).toBe('in-progress');
  });

  it('buckets a fully-done course as completed', () => {
    expect(PROGRESS_FILTER.getValue(withProgress(3, 3))).toBe('completed');
  });
});
