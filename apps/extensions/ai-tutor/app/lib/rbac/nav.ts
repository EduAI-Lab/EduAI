import type { AtNavItem, AtUser } from './types';
import {
  canAccessAdminConsole,
  canViewCourseAnalytics,
  canViewCourseFeedback,
  canViewTeachingContent,
  usesInstructorShell,
} from './permissions';

export function getNavForUser(user: AtUser | null | undefined): AtNavItem[] {
  const items: AtNavItem[] = [];

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
    // as source of truth); AI Tutor no longer exposes them. Bug report triage stays.
    items.push({ key: 'admin-bug-reports', title: 'Bug Reports', href: '/admin' });
  }

  return items;
}

export function getCourseDetailTabs(user: AtUser | null | undefined) {
  const tabs: Array<{
    id: 'content' | 'enrollments' | 'submissions' | 'feedback' | 'analytics';
    label: string;
  }> = [{ id: 'content', label: 'Content' }];

  if (canViewTeachingContent(user) && user?.role !== 'TA') {
    tabs.push({ id: 'enrollments', label: 'Enrollments' });
  }

  if (canViewCourseAnalytics(user) || user?.role === 'TA') {
    tabs.push({ id: 'submissions', label: 'Submissions' });
  }

  if (canViewCourseFeedback(user)) {
    tabs.push({ id: 'feedback', label: 'Feedback' });
  }

  if (canViewCourseAnalytics(user)) {
    tabs.push({ id: 'analytics', label: 'Analytics' });
  }

  return tabs;
}
