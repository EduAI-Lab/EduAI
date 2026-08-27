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
  locationBox,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
  useDisplayCoursesMock: vi.fn(),
  useQmLayoutMock: vi.fn(),
  useGuidedTourMock: vi.fn(),
  useAutoStartMainTourMock: vi.fn(),
  locationBox: { current: { pathname: '/courses', state: null as any } },
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationBox.current,
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

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  locationBox.current = { pathname: '/courses', state: null };
});

function setup(
  role: string,
  courses: any[] = [{ id: 1, name: 'Intro' }],
  overrides: { openProfile?: any; startTour?: any; isActive?: boolean; registerStepAction?: any } = {},
) {
  useAuthMock.mockReturnValue({ user: { role } });
  useDisplayCoursesMock.mockReturnValue({ displayCourses: courses, isLoading: false });
  useQmLayoutMock.mockReturnValue({
    setGuidedTourHandler: vi.fn(),
    openProfile: overrides.openProfile ?? vi.fn(),
  });
  useGuidedTourMock.mockReturnValue({
    startTour: overrides.startTour ?? vi.fn(),
    registerStepAction: overrides.registerStepAction ?? vi.fn(() => vi.fn()),
    isActive: overrides.isActive ?? false,
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

  it('registers a guided-tour handler that highlights the first course and starts the tour', () => {
    const startTour = vi.fn();
    setup('ADMIN', [{ id: 7, name: 'Data' }], { startTour });
    let handler: any;
    useQmLayoutMock.mockReturnValue({
      setGuidedTourHandler: (fn: any) => {
        handler = fn;
      },
      openProfile: vi.fn(),
    });
    render(<CourseSelectionPage />);
    handler();
    expect(startTour).toHaveBeenCalledWith('main');
    expect(sessionStorage.getItem('qm:tour-course-id')).toBe('7');
  });

  it('opens the profile flow from the guided-tour handler when there are no courses', () => {
    const openProfile = vi.fn();
    const startTour = vi.fn();
    setup('ADMIN', [], { openProfile, startTour });
    let handler: any;
    useQmLayoutMock.mockReturnValue({
      setGuidedTourHandler: (fn: any) => {
        handler = fn;
      },
      openProfile,
    });
    render(<CourseSelectionPage />);
    handler();
    expect(openProfile).toHaveBeenCalled();
    expect(startTour).toHaveBeenCalledWith('main');
  });

  it('starts the tour automatically when arriving with startGuidedTour state', () => {
    locationBox.current = {
      pathname: '/courses',
      state: { startGuidedTour: true, returnCourseId: 3 },
    };
    const startTour = vi.fn();
    setup('ADMIN', [{ id: 3, name: 'Data' }], { startTour });
    render(<CourseSelectionPage />);
    expect(startTour).toHaveBeenCalledWith('main');
    expect(sessionStorage.getItem('qm:tour-course-id')).toBe('3');
    expect(navigateMock).toHaveBeenCalledWith('/courses', { replace: true, state: {} });
  });

  it('registers a course-select tour step that opens the resolved course on the questions tab', () => {
    let registeredAction: any;
    const registerStepAction = vi.fn((_id: string, action: any) => {
      registeredAction = action;
      return vi.fn();
    });
    sessionStorage.setItem('qm:tour-course-id', '7');
    setup('ADMIN', [{ id: 7, name: 'Data' }], { isActive: true, registerStepAction });
    render(<CourseSelectionPage />);
    expect(registerStepAction).toHaveBeenCalledWith('course-select', expect.any(Function));
    registeredAction();
    expect(navigateMock).toHaveBeenCalledWith('/courses/7?tab=questions', { replace: true });
  });

  it('opens the profile flow from the tour step when there is no course to resolve', () => {
    let registeredAction: any;
    const registerStepAction = vi.fn((_id: string, action: any) => {
      registeredAction = action;
      return vi.fn();
    });
    const openProfile = vi.fn();
    setup('ADMIN', [], { isActive: true, registerStepAction, openProfile });
    useQmLayoutMock.mockReturnValue({ setGuidedTourHandler: vi.fn(), openProfile });
    render(<CourseSelectionPage />);
    registeredAction();
    expect(openProfile).toHaveBeenCalled();
  });
});
