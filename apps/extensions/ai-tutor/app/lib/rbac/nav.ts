import type { AtNavItem, AtUser } from './types';
import {
  canAccessAdminConsole,
  canViewCourseAnalytics,
  canViewTeachingContent,
  usesInstructorShell,
} from './permissions';

export function getNavForUser(user: AtUser | null | undefined): AtNavItem[] {
  const items: AtNavItem[] = [];

  if (user?.role === 'STUDENT') {
    items.push({
      key: 'my-courses',
      title: 'My courses',
      href: '/student',
    });
  }

  if (usesInstructorShell(user)) {
    items.push({
      key: 'teaching',
      title: 'Teaching',
      href: '/instructor',
    });
  }

  if (canAccessAdminConsole(user)) {
    items.push(
      { key: 'admin-users', title: 'User Management', href: '/admin?tab=users' },
      { key: 'admin-enrollments', title: 'Enrollments', href: '/admin?tab=enrollments' },
      { key: 'admin-bug-reports', title: 'Bug Reports', href: '/admin?tab=bugReports' },
    );
  }

  return items;
}

export function getCourseDetailTabs(user: AtUser | null | undefined) {
  const tabs: Array<{ id: 'content' | 'enrollments' | 'submissions' | 'analytics'; label: string }> =
    [{ id: 'content', label: 'Content' }];

  if (canViewTeachingContent(user) && user?.role !== 'TA') {
    tabs.push({ id: 'enrollments', label: 'Enrollments' });
  }

  if (canViewCourseAnalytics(user) || user?.role === 'TA') {
    tabs.push({ id: 'submissions', label: 'Submissions' });
  }

  if (canViewCourseAnalytics(user)) {
    tabs.push({ id: 'analytics', label: 'Analytics' });
  }

  return tabs;
}
