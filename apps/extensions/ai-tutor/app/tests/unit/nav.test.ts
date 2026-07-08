import { describe, expect, it } from 'vitest';
import { getCourseDetailTabs, getNavForUser } from '~/lib/rbac';
import type { AtUser } from '~/lib/rbac/types';

const u = (role: AtUser['role']): AtUser => ({ id: '1', role });

describe('getNavForUser', () => {
  it("labels the student course list 'Courses' (#741)", () => {
    const nav = getNavForUser(u('STUDENT'));
    expect(nav).toEqual([{ key: 'my-courses', title: 'Courses', href: '/student' }]);
  });

  it("labels every instructor-shell role's course list 'Courses' (#741)", () => {
    for (const role of ['INSTRUCTOR', 'UNIT_ADMIN', 'TA'] as const) {
      const teaching = getNavForUser(u(role)).find((i) => i.key === 'teaching');
      expect(teaching).toEqual({ key: 'teaching', title: 'Courses', href: '/instructor' });
    }
  });

  it('never labels nav "My courses" or "Teaching" for any role (#741 regression)', () => {
    for (const role of ['STUDENT', 'INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN'] as const) {
      const titles = getNavForUser(u(role)).map((i) => i.title);
      expect(titles).not.toContain('My courses');
      expect(titles).not.toContain('Teaching');
    }
  });

  it('drops User Management and Enrollments from admin nav, keeps Bug Reports (#734/#735)', () => {
    const nav = getNavForUser(u('ADMIN'));
    const keys = nav.map((i) => i.key);
    expect(keys).not.toContain('admin-users');
    expect(keys).not.toContain('admin-enrollments');
    expect(nav).toContainEqual({
      key: 'admin-bug-reports',
      title: 'Bug Reports',
      href: '/admin',
    });
  });

  it('gives admins the shared Courses dashboard plus Bug Reports (#781)', () => {
    const nav = getNavForUser(u('ADMIN'));
    expect(nav).toEqual([
      { key: 'admin-courses', title: 'Courses', href: '/instructor' },
      { key: 'admin-bug-reports', title: 'Bug Reports', href: '/admin' },
    ]);
  });

  it('returns no nav items for a null user', () => {
    expect(getNavForUser(null)).toEqual([]);
    expect(getNavForUser(undefined)).toEqual([]);
  });
});

describe('getCourseDetailTabs', () => {
  it('shows feedback for instructor-shell roles but not students (#784)', () => {
    for (const role of ['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN'] as const) {
      const tabs = getCourseDetailTabs(u(role));
      expect(tabs.map((tab) => tab.id)).toContain('feedback');
    }
    expect(getCourseDetailTabs(u('STUDENT')).map((tab) => tab.id)).not.toContain('feedback');
  });

  it('keeps submissions and feedback alongside analytics for instructors (#784)', () => {
    const tabs = getCourseDetailTabs(u('INSTRUCTOR')).map((tab) => tab.id);
    expect(tabs).toEqual(['content', 'enrollments', 'submissions', 'feedback', 'analytics']);
  });
});
