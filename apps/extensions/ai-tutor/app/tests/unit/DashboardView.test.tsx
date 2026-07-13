import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import {
  DashboardView,
  type DashboardCourseRow,
  type DashboardQuickAction,
  type DashboardStatDef,
} from '~/components/dashboard/DashboardView';

/**
 * The redesigned `/dashboard` landing renders through this shared, props-driven
 * shell (replaces the deleted `RoleDashboard`). Pure presentational — these
 * tests assert it surfaces exactly the stats/courses/actions it is handed.
 */
const stats: DashboardStatDef[] = [
  { label: 'Enrolled courses', value: 3 },
  { label: 'In progress', value: 1 },
];

const courses: DashboardCourseRow[] = [
  { id: 1, code: 'CPSC 101', name: 'Intro to CS', term: 'W1', year: 2026, accentColor: '#123456', progressLabel: '40% complete' },
  { id: 2, code: 'MATH 200', name: 'Calculus III', term: 'W2', year: 2026, accentColor: '#654321' },
];

const quickActions: DashboardQuickAction[] = [
  { label: 'Browse courses', description: 'See everything you teach', href: '/instructor', icon: <span>icon</span> },
];

function renderView(overrides: Partial<React.ComponentProps<typeof DashboardView>> = {}) {
  return render(
    <MemoryRouter>
      <DashboardView
        stats={stats}
        courses={courses}
        coursesHref="/student"
        leftPanelTitle="Your courses"
        quickActions={quickActions}
        rightPanelTitle="Pick up where you left off"
        rightPanel={<div>resume panel body</div>}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DashboardView', () => {
  it('renders every stat card with its label and value', () => {
    renderView();
    expect(screen.getByText('Enrolled courses')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders each course row with a link to the course and its progress label', () => {
    renderView();
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
    expect(screen.getByText('40% complete')).toBeInTheDocument();
    const link = screen.getByText('Intro to CS').closest('a');
    expect(link).toHaveAttribute('href', '/student/courses/1');
  });

  it('renders panel titles, quick actions, and the injected right panel', () => {
    renderView();
    expect(screen.getByText('Your courses')).toBeInTheDocument();
    expect(screen.getByText('Pick up where you left off')).toBeInTheDocument();
    expect(screen.getByText('Browse courses')).toBeInTheDocument();
    expect(screen.getByText('resume panel body')).toBeInTheDocument();
  });

  it('shows the empty state with a browse link when there are no courses', () => {
    renderView({ courses: [] });
    expect(screen.getByText('No courses found.')).toBeInTheDocument();
    expect(screen.getByText('Browse courses →').closest('a')).toHaveAttribute('href', '/student');
  });
});
