import type { QmNavItem, QmNavItemKey, QmUser } from './types';
import { getCoreDashboardUrl } from '@/lib/coreUrl';
import {
  canManageAssessment,
  canUseVariantWorkflow,
} from './permissions';
import { resolvePlatformCourseAccess } from './resolve-course-access';

const CORE_NAV: Omit<QmNavItem, 'key'>[] = [
  {
    title: 'Courses',
    href: '/courses',
    match: (pathname) => pathname === '/courses',
  },
  {
    title: 'Questions',
    href: '/home?tab=questions',
    match: (pathname, search) =>
      pathname === '/home' && !search.includes('tab=assessments'),
  },
  {
    title: 'Assessments',
    href: '/home?tab=assessments',
    match: (pathname, search) =>
      pathname === '/home' && search.includes('tab=assessments'),
  },
  {
    title: 'Variants',
    href: '/assessment-variant',
    match: (pathname) => pathname.startsWith('/assessment-variant'),
  },
  {
    title: 'Help',
    href: '/help',
    match: (pathname) => pathname === '/help',
  },
];

const NAV_KEYS: QmNavItemKey[] = [
  'courses',
  'questions',
  'assessments',
  'variants',
  'help',
];

function withKeys(items: Omit<QmNavItem, 'key'>[], keys: QmNavItemKey[]): QmNavItem[] {
  return items.map((item, index) => ({ ...item, key: keys[index] }));
}

/** Main sidebar links per rbac-matrix §16–18. */
export function getNavForUser(user: QmUser | null | undefined): QmNavItem[] {
  const access = resolvePlatformCourseAccess(user);
  const nav = withKeys(CORE_NAV, NAV_KEYS).filter((item) => {
    if (item.key === 'variants') {
      return canUseVariantWorkflow(user, access);
    }
    return true;
  });

  return nav;
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
