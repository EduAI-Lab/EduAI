import type { AtNavItem, AtUser } from './types';
import {
  canAccessAdminConsole,
  canViewCourseAnalytics,
  canViewTeachingContent,
  usesInstructorShell,
} from './permissions';

export function getNavForUser(user: AtUser | null | undefined): AtNavItem[] {
  const items: AtNavItem[] = [];

  // Dashboard is the shared landing page for every supported role — always
  // first so it reads as "home" the same way Core's sidebar does.
  if (user) {
    items.push({ key: 'dashboard', title: 'Dashboard', href: '/dashboard' });
  }

  if (user?.role === 'STUDENT') {
    items.push({
      key: 'my-courses',
      title: 'Courses',
      href: '/student',
    });
  }

  if (usesInstructorShell(user)) {
    items.push({
      key: 'teaching',
      title: 'Courses',
      href: '/instructor',
    });
  }

  if (user?.role === 'ADMIN') {
    // Admins get the same Courses dashboard as instructors (admin ⊇ instructor)
    // so every role shares one consistent landing page. Course-list/detail access
    // is granted server-side via the platform-admin branches in the API.
    items.push({ key: 'admin-courses', title: 'Courses', href: '/instructor' });
  }

  if (canAccessAdminConsole(user)) {
    // User management and enrollments are owned by EduAI Core (synced from Canvas
    // as source of truth); AI Tutor no longer exposes them. The admin console
    // hosts bug-report triage + AI configuration.
    items.push({ key: 'admin-bug-reports', title: 'Admin', href: '/admin' });
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
