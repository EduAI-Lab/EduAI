/**
 * Unit tests for CourseSelectionPage (#1544): role-based view selection and
 * the course-select handler. Child views, hooks, and tour wiring are mocked
 * so we exercise only this page's own routing/dispatch logic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const {
  navigateMock,
  useAuthMock,
  useDisplayCoursesMock,
  useQmLayoutMock,
  useGuidedTourMock,
  useAutoStartMainTourMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
  useDisplayCoursesMock: vi.fn(),
  useQmLayoutMock: vi.fn(),
  useGuidedTourMock: vi.fn(),
  useAutoStartMainTourMock: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/courses', state: null }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/components/layout/QmLayoutContext', () => ({ useQmLayout: () => useQmLayoutMock() }));
vi.mock('@/hooks/useDisplayCourses', () => ({ useDisplayCourses: () => useDisplayCoursesMock() }));
vi.mock('@/contexts/GuidedTourContext', () => ({ useGuidedTour: () => useGuidedTourMock() }));
vi.mock('@/tour/useAutoStartMainTour', () => ({
  useAutoStartMainTour: (...args: any[]) => useAutoStartMainTourMock(...args),
}));

let lastAdminProps: any;
let lastUnitAdminProps: any;
vi.mock('@/components/courses/courses-role-view', () => ({
  CoursesRoleView: (props: any) => {
    lastAdminProps = props;
    return (
      <div>
        role-view:{props.role}
        {props.courses.map((c: any) => (
          <button key={c.id} onClick={() => props.onSelectCourse(c)}>
            select-{c.id}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock('@/components/courses/courses-unit-admin-view', () => ({
  CoursesUnitAdminView: (props: any) => {
    lastUnitAdminProps = props;
    return <div>unit-admin-view</div>;
  },
}));

import { CourseSelectionPage } from '@/pages/CourseSelectionPage';

afterEach(cleanup);

function setup(role: string, courses: any[] = [{ id: 1, name: 'Intro' }]) {
  useAuthMock.mockReturnValue({ user: { role } });
  useDisplayCoursesMock.mockReturnValue({ displayCourses: courses, isLoading: false });
  useQmLayoutMock.mockReturnValue({ setGuidedTourHandler: vi.fn(), openProfile: vi.fn() });
  useGuidedTourMock.mockReturnValue({
    startTour: vi.fn(),
    registerStepAction: vi.fn(() => vi.fn()),
    isActive: false,
  });
}

describe('CourseSelectionPage', () => {
  it('renders CoursesRoleView with admin role for ADMIN users', () => {
    setup('ADMIN');
    render(<CourseSelectionPage />);
    expect(screen.getByText('role-view:admin')).toBeInTheDocument();
  });

  it('renders CoursesUnitAdminView for UNIT_ADMIN users', () => {
    setup('UNIT_ADMIN');
    render(<CourseSelectionPage />);
    expect(screen.getByText('unit-admin-view')).toBeInTheDocument();
  });

  it('renders CoursesRoleView with instructor role by default', () => {
    setup('INSTRUCTOR');
    render(<CourseSelectionPage />);
    expect(screen.getByText('role-view:instructor')).toBeInTheDocument();
  });

  it('navigates to the course overview tab when a course is selected', () => {
    setup('ADMIN', [{ id: 7, name: 'Data' }]);
    render(<CourseSelectionPage />);
    fireEvent.click(screen.getByText('select-7'));
    expect(navigateMock).toHaveBeenCalledWith('/courses/7?tab=overview');
  });
});
