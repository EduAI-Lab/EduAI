/**
 * Unit tests for the QM `CommandPalette` adapter (#1546): builds the "Go to" /
 * course-scoped / "Switch course" / app-switcher groups handed to the shared
 * `@eduai/ui` palette. The shared palette itself is mocked so this exercises
 * only QM's own group-building logic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const navigate = vi.fn();
let pathnameValue = '/dashboard';
let displayCoursesValue: any[] = [];
let userValue: any = { id: '1', role: 'instructor' };
let capturedGroups: any[] = [];

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: pathnameValue }),
}));

vi.mock('@eduai/ui', () => ({
  CommandPalette: (props: any) => {
    capturedGroups = props.groups;
    return <div data-testid="shared-palette" data-open-event={props.openEventName} />;
  },
  buildAppSwitcherGroup: (opts: any) => ({ heading: 'Switch app', items: [], __opts: opts }),
}));

vi.mock('@/hooks/useDisplayCourses', () => ({
  useDisplayCourses: () => ({ displayCourses: displayCoursesValue }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: userValue }),
}));

vi.mock('@/lib/apps', () => ({
  CURRENT_APP_ID: 'question-maker',
  getLauncherApps: () => [{ id: 'core' }],
}));

vi.mock('@/lib/rbac/nav', () => ({
  getNavForUser: (user: any) => (user ? [{ key: 'dashboard', title: 'Dashboard', href: '/dashboard' }] : []),
  getNavSecondaryForUser: (user: any) => (user ? [{ key: 'help', title: 'Help', href: '/help' }] : []),
}));

import { CommandPalette } from '@/components/command/CommandPalette';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathnameValue = '/dashboard';
  displayCoursesValue = [];
  userValue = { id: '1', role: 'instructor' };
  capturedGroups = [];
});

describe('CommandPalette', () => {
  it('opens on the qm:open-command event', () => {
    const { getByTestId } = render(<CommandPalette />);
    expect(getByTestId('shared-palette').dataset.openEvent).toBe('qm:open-command');
  });

  it('includes nav items plus a Settings entry in "Go to"', () => {
    render(<CommandPalette />);
    const goTo = capturedGroups.find((g) => g.heading === 'Go to');
    const labels = goTo.items.map((i: any) => i.label);
    expect(labels).toEqual(['Dashboard', 'Help', 'Settings']);
  });

  it('navigates when a "Go to" item is selected', () => {
    render(<CommandPalette />);
    const goTo = capturedGroups.find((g) => g.heading === 'Go to');
    goTo.items.find((i: any) => i.label === 'Settings').onSelect();
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('shows "This course" heading with no items when not on a course route', () => {
    pathnameValue = '/dashboard';
    render(<CommandPalette />);
    const courseGroup = capturedGroups.find((g) => g.heading === 'This course');
    expect(courseGroup.items).toEqual([]);
  });

  it('shows the course-scoped actions and the course code as heading on a course route', () => {
    pathnameValue = '/courses/7';
    displayCoursesValue = [{ id: 7, code: 'CPSC 101', name: 'Intro to CS' }];
    render(<CommandPalette />);
    const courseGroup = capturedGroups.find((g) => g.heading === 'CPSC 101');
    expect(courseGroup.items.map((i: any) => i.label)).toContain('New question');

    courseGroup.items.find((i: any) => i.label === 'New question').onSelect();
    expect(navigate).toHaveBeenCalledWith('/courses/7/questions/new');
  });

  it('falls back to "This course" heading when the course is not in displayCourses', () => {
    pathnameValue = '/courses/99';
    displayCoursesValue = [];
    render(<CommandPalette />);
    expect(capturedGroups.some((g) => g.heading === 'This course')).toBe(true);
  });

  it('lists up to 8 courses under "Switch course" and navigates on select', () => {
    displayCoursesValue = Array.from({ length: 10 }, (_, i) => ({ id: i, code: `C${i}`, name: `Course ${i}` }));
    render(<CommandPalette />);
    const switchGroup = capturedGroups.find((g) => g.heading === 'Switch course');
    expect(switchGroup.items).toHaveLength(8);

    switchGroup.items[0].onSelect();
    expect(navigate).toHaveBeenCalledWith('/courses/0');
  });

  it('includes the app-switcher group built from getLauncherApps', () => {
    render(<CommandPalette />);
    expect(capturedGroups.some((g) => g.heading === 'Switch app')).toBe(true);
  });

  it('produces empty "Go to" items when there is no user', () => {
    userValue = null;
    render(<CommandPalette />);
    const goTo = capturedGroups.find((g) => g.heading === 'Go to');
    expect(goTo.items.map((i: any) => i.label)).toEqual(['Settings']);
  });
});
