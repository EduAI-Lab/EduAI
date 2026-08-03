/**
 * #1208: the dashboard panels render a bounded page, so they must say so.
 *
 * Covers the role dispatch in `DashboardHome` that threads `courseTotal` down to
 * the panels — before this, a user with more courses than the page size saw a
 * silently partial "needs attention" / "continue learning" list.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Prof Test', role: 'INSTRUCTOR' } }),
}));

import DashboardHome from '~/routes/dashboard';
import { ShellBreadcrumbProvider } from '~/components/layout/ShellBreadcrumbContext';
import type { Route } from '../../routes/+types/dashboard';
import type { Course } from '~/lib/types';

const courses = [
  { id: 1, title: 'MATH 221 Linear Algebra', code: 'MATH 221', isPublished: false },
] as Partial<Course>[];

function renderDashboard(role: string, courseTotal: number) {
  const props = {
    loaderData: {
      role,
      courses,
      courseTotal,
      submissions: [],
      adminUsers: null,
      adminBugReports: [],
      dashboardStats: null,
    },
  } as unknown as Route.ComponentProps;

  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ShellBreadcrumbProvider>
        <DashboardHome {...props} />
      </ShellBreadcrumbProvider>
    </MemoryRouter>,
  );
}

describe('DashboardHome — truncation disclosure (#1208)', () => {
  it.each(['INSTRUCTOR', 'UNIT_ADMIN'])(
    'discloses the bounded page to a %s',
    (role) => {
      renderDashboard(role, 4312);

      expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
        'Showing 1 of 4,312 courses',
      );
    },
  );

  it.each(['STUDENT', 'TA'])('discloses the bounded page to a %s', (role) => {
    renderDashboard(role, 900);

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent('Showing 1 of 900');
  });

  it('says nothing when the page already holds every course', () => {
    renderDashboard('INSTRUCTOR', courses.length);

    expect(screen.queryByTestId('truncated-list-notice')).not.toBeInTheDocument();
  });
});
