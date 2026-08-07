import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router';
import StudentHome from '~/routes/student';
import type { Route } from '../../routes/+types/student';
import { AuthProvider } from '~/hooks/useLocalUser';
import { ShellBreadcrumbProvider } from '~/components/layout/ShellBreadcrumbContext';
import type { Course } from '~/lib/types';

/**
 * #1208: the route now reads `useNavigation`/`useSearchParams` to drive
 * server-side search + filters, so it needs a real data router rather than the
 * plain `MemoryRouter` this used before.
 */
export function renderStudentHome(
  role: 'STUDENT' | 'TA',
  courses: Course[],
  overrides: Partial<Route.ComponentProps['loaderData']> = {},
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
  } as Route.ComponentProps;

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
    <AuthProvider initialUser={{ id: 'u1', name: 'User', role }}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe('StudentHome (#746 review: TA preview must stay student-shaped)', () => {
  const courses = [{ id: 1, title: 'Course 1', isPublished: true }];

  it('renders the student course grid for a STUDENT', () => {
    renderStudentHome('STUDENT', courses as Course[]);
    expect(screen.getByText('Course 1')).toBeInTheDocument();
  });

  it('renders the same student course grid for a TA previewing /student', () => {
    renderStudentHome('TA', courses as Course[]);
    expect(screen.getByText('Course 1')).toBeInTheDocument();
  });
});
