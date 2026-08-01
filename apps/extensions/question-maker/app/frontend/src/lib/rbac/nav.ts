import type { QmNavItem, QmNavItemKey, QmUser } from './types';
import { getCoreDashboardUrl } from '@/lib/coreUrl';
import { canManageAssessment, canTriageBugReports } from './permissions';
import { resolvePlatformCourseAccess } from './resolve-course-access';

/**
 * Main sidebar links, per rbac-matrix §16–18.
 *
 * Single source for QM's chrome: the sidebar (`QmAppLayout`) and the ⌘K palette
 * both read from here, matching how Core and AI Tutor each drive both surfaces
 * from their own `lib/rbac/nav`. QM previously carried a hardcoded copy in the
 * layout and a third hardcoded list in the command palette, neither of which
 * applied any role gate — which is why the admin-only Bug reports entry was
 * unreachable from the UI despite this function already gating it correctly.
 */
const CORE_NAV: Omit<QmNavItem, 'key'>[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    match: (pathname) => pathname === '/dashboard',
  },
  {
    title: 'Courses',
    href: '/courses',
    match: (pathname) => pathname.startsWith('/courses'),
  },
  {
    title: 'Question Library',
    href: '/library',
    match: (pathname) => pathname === '/library',
  },
];

const NAV_KEYS: QmNavItemKey[] = ['dashboard', 'courses', 'library'];

function withKeys(items: Omit<QmNavItem, 'key'>[], keys: QmNavItemKey[]): QmNavItem[] {
  return items.map((item, index) => ({ ...item, key: keys[index] }));
}

export function getNavForUser(user: QmUser | null | undefined): QmNavItem[] {
  if (!user) return [];
  const nav = withKeys(CORE_NAV, NAV_KEYS);

  if (canTriageBugReports(user)) {
    nav.push({
      key: 'bug-reports',
      title: 'Bug reports',
      href: '/admin/bug-reports',
      match: (pathname) => pathname === '/admin/bug-reports',
    });
  }

  return nav;
}

/** Secondary sidebar links. Settings lives in the navUser dropdown, like Core. */
export function getNavSecondaryForUser(user: QmUser | null | undefined): QmNavItem[] {
  if (!user) return [];
  return [
    {
      key: 'help',
      title: 'Help',
      href: '/help',
      match: (pathname) => pathname === '/help',
    },
  ];
}

export function getFooterNavForUser(_user: QmUser | null | undefined): QmNavItem[] {
  return [
    {
      key: 'back-to-eduai',
      title: 'Back to EduAI',
      href: getCoreDashboardUrl(),
      external: true,
    },
  ];
}

export function getRoleViewLabel(role: string | undefined): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'UNIT_ADMIN':
      return 'Unit administrator';
    case 'INSTRUCTOR':
      return 'Instructor';
    default:
      return 'User';
  }
}

export function canShowAssessmentWriteNav(user: QmUser | null | undefined): boolean {
  return canManageAssessment(user, resolvePlatformCourseAccess(user));
}
