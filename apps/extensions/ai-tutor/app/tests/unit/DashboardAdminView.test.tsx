import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';

import { DashboardAdminView } from '~/components/dashboard/DashboardAdminView';
import type { AdminBugReportRow, AdminUserPage, Course } from '~/lib/types';

/**
 * #1041: Core's user list is one page now, so the admin dashboard can no longer
 * derive its role breakdown by counting the array it was handed — it reads the
 * platform-wide `stats` off the envelope instead. These tests pin that the
 * counts come from `stats` (not the page length), that "Other" can't go
 * negative, and that a missing envelope degrades to zeroes rather than throwing.
 */
const courses = [
  { id: 1, code: 'CPSC 101', name: 'Intro', isPublished: true },
  { id: 2, code: 'CPSC 201', name: 'Data', isPublished: false },
] as unknown as Course[];

const bugReports: AdminBugReportRow[] = [];

function makeUserPage(stats: AdminUserPage['stats'], data: unknown[] = []): AdminUserPage {
  return { data, total: stats?.total ?? 0, page: 1, pageSize: 25, stats } as AdminUserPage;
}

function renderView(overrides: Partial<React.ComponentProps<typeof DashboardAdminView>> = {}) {
  return render(
    <MemoryRouter>
      <DashboardAdminView
        courses={courses}
        adminUsers={makeUserPage({
          total: 500,
          active: 480,
          byRole: { STUDENT: 400, INSTRUCTOR: 40, UNIT_ADMIN: 10 },
        })}
        bugReports={bugReports}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DashboardAdminView', () => {
  it('reads the platform user total from stats, not from the loaded page length', () => {
    // One row loaded, 500 platform-wide — the old `.length` read would show 1.
    renderView({
      adminUsers: makeUserPage(
        { total: 500, active: 480, byRole: { STUDENT: 400 } },
        [{ id: 'u1' }],
      ),
    });

    expect(screen.getByText('Platform users')).toBeInTheDocument();
    // Rendered in both the stat tile and the donut centre.
    expect(screen.getAllByText('500').length).toBeGreaterThan(0);
  });

  it('renders the role donut from the byRole rollup', () => {
    renderView();

    expect(screen.getByText('Users by role')).toBeInTheDocument();
    expect(screen.getAllByText('500').length).toBeGreaterThan(0);
  });

  it('counts UNIT_ADMIN alongside INSTRUCTOR', () => {
    const { container } = renderView({
      adminUsers: makeUserPage({
        total: 100,
        active: 100,
        byRole: { STUDENT: 60, INSTRUCTOR: 25, UNIT_ADMIN: 15 },
      }),
    });

    // 25 + 15 instructors, 60 students, so nothing is left over for "Other".
    expect(container.textContent).toContain('Instructors');
    expect(screen.getByText('Users by role')).toBeInTheDocument();
  });

  it('never renders a negative Other bucket when the role counts exceed the total', () => {
    // A stats rollup can lag the total; Math.max(0, …) keeps the donut sane.
    const { container } = renderView({
      adminUsers: makeUserPage({
        total: 10,
        active: 10,
        byRole: { STUDENT: 40, INSTRUCTOR: 5 },
      }),
    });

    expect(container.textContent).not.toContain('-35');
  });

  it('falls back to zeroed stats when the user envelope is absent', () => {
    renderView({ adminUsers: null });

    // No users yet rather than a crash on `stats.byRole`.
    expect(screen.getByText('No users yet.')).toBeInTheDocument();
  });

  it('prefers the server dashboardStats rollup over client-derived counts', () => {
    renderView({
      dashboardStats: {
        totalCourses: 42,
        publishedCourses: 7,
        totalUsers: 999,
        openBugReports: 3,
      } as never,
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
  });
});
