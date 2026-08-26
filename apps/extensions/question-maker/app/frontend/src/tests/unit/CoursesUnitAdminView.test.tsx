/**
 * Unit tests for `CoursesUnitAdminView` (#1546): unit-scoped course list for
 * unit admins — the "no authorized units" warning, the unit filter (only shown
 * with >1 unit), and the unit-driven empty hint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CoursesUnitAdminView } from '@/components/courses/courses-unit-admin-view';
import type { Course } from '@/types/question';

let userValue: any = { id: '1', role: 'unit-admin', authorizedUnits: [] };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: userValue }),
}));

afterEach(() => {
  cleanup();
  userValue = { id: '1', role: 'unit-admin', authorizedUnits: [] };
});

describe('CoursesUnitAdminView', () => {
  it('shows the "no authorized units" warning when the user has none', () => {
    render(<CoursesUnitAdminView courses={[]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No authorized units are assigned');
  });

  it('does not show the warning when the user has authorized units', () => {
    userValue = { id: '1', role: 'unit-admin', authorizedUnits: ['CPSC'] };
    render(<CoursesUnitAdminView courses={[]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the units in the subheading for a single unit and hides the filter select', () => {
    userValue = { id: '1', role: 'unit-admin', authorizedUnits: ['CPSC'] };
    const course = { id: 1, name: 'Intro to CS', code: 'CPSC 101', department: 'CPSC' } as Course;
    render(<CoursesUnitAdminView courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText(/Courses in CPSC/)).toBeInTheDocument();
    expect(screen.queryByText('Filter by unit')).toBeNull();
  });

  it('shows the unit filter select when the user has more than one unit', () => {
    userValue = { id: '1', role: 'unit-admin', authorizedUnits: ['CPSC', 'MATH'] };
    const course = { id: 1, name: 'Intro to CS', code: 'CPSC 101', department: 'CPSC' } as Course;
    render(<CoursesUnitAdminView courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText('Filter by unit')).toBeInTheDocument();
    expect(screen.getByText(/Courses in CPSC, MATH/)).toBeInTheDocument();
  });

  it('renders courses passed through to the grid', () => {
    const course = { id: 1, name: 'Intro to CS', code: 'CPSC 101', department: 'CPSC' } as Course;
    userValue = { id: '1', role: 'unit-admin', authorizedUnits: ['CPSC'] };
    render(<CoursesUnitAdminView courses={[course]} isLoading={false} onSelectCourse={vi.fn()} />);
    expect(screen.getByText('CPSC 101')).toBeInTheDocument();
  });
});
