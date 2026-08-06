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

/** A page of `n` distinct courses, for asserting on how many of them render. */
function pageOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Course ${i + 1}`,
    code: `CS ${100 + i}`,
    isPublished: false,
  })) as Partial<Course>[];
}

function renderDashboard(role: string, courseTotal: number, courseList = courses) {
  const props = {
    loaderData: {
      role,
      courses: courseList,
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
  it.each(['INSTRUCTOR', 'UNIT_ADMIN'])('discloses the bounded page to a %s', (role) => {
    renderDashboard(role, 4312);

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
      'Showing 1 of 4,312 courses',
    );
  });

  it.each(['STUDENT', 'TA'])('discloses the bounded page to a %s', (role) => {
    renderDashboard(role, 900);

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent('Showing 1 of 900');
  });

  it('discloses the bounded page to an ADMIN', () => {
    // Admin's right panel is bug-report triage, not a course panel, so the
    // disclosure has to ride on the course list itself — it was the one role
    // that got a silently partial list.
    renderDashboard('ADMIN', 4312);

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
      'Showing 1 of 4,312 courses',
    );
  });

  it("counts the ADMIN list's rendered rows, not the page it was given", () => {
    // The list renders a 5-row preview of the page. Reporting the page length
    // here would claim 40 rows are on screen when 5 are.
    renderDashboard('ADMIN', 4312, pageOf(40));

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
      'Showing 5 of 4,312 courses',
    );
  });

  it('still discloses to an ADMIN whose page holds every course', () => {
    // The regression this pins: with total === page length there is nothing
    // "past the page", but the 5-row preview still hides the rest, so counting
    // the page would suppress the notice and truncate silently again.
    renderDashboard('ADMIN', 8, pageOf(8));

    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent('Showing 5 of 8 courses');
  });

  it('says nothing when the page already holds every course', () => {
    renderDashboard('INSTRUCTOR', courses.length);

    expect(screen.queryByTestId('truncated-list-notice')).not.toBeInTheDocument();
  });
});
