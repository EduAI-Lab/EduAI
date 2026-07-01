import { describe, expect, it } from 'vitest';
import { buildDashboardStats } from '~/lib/dashboard-stats';
import type { AdminBugReportRow, AdminUser, Course } from '~/lib/types';

const course = (over: Partial<Course>): Course =>
  ({ id: 1, title: 'C', isPublished: false, ...over }) as Course;

describe('buildDashboardStats', () => {
  it('STUDENT: enrolled / in-progress / completed via completed-vs-total (no isComplete)', () => {
    const courses = [
      course({ id: 1, progress: { completed: 2, total: 4, percentage: 50 } }), // in progress
      course({ id: 2, progress: { completed: 3, total: 3, percentage: 100 } }), // completed
      course({ id: 3 }), // not started
    ];
    expect(buildDashboardStats('STUDENT', { courses })).toEqual([
      { label: 'Enrolled courses', value: 3 },
      { label: 'In progress', value: 1 },
      { label: 'Completed', value: 1 },
    ]);
  });

  it('instructor-shell roles get teaching stats (your courses / published / draft)', () => {
    const courses = [course({ id: 1, isPublished: true }), course({ id: 2, isPublished: false })];
    for (const role of ['INSTRUCTOR', 'UNIT_ADMIN', 'TA'] as const) {
      expect(buildDashboardStats(role, { courses })).toEqual([
        { label: 'Your courses', value: 2 },
        { label: 'Published', value: 1 },
        { label: 'Draft', value: 1 },
      ]);
    }
  });

  it('ADMIN gets platform stats (users / courses / open + total reports)', () => {
    const users = [{}, {}] as AdminUser[];
    const courses = [course({ id: 1 })];
    const bugReports = [{ status: 'resolved' }, { status: 'unhandled' }] as AdminBugReportRow[];
    expect(buildDashboardStats('ADMIN', { users, courses, bugReports })).toEqual([
      { label: 'Users', value: 2 },
      { label: 'Courses', value: 1 },
      { label: 'Open bug reports', value: 1 },
      { label: 'Total reports', value: 2 },
    ]);
  });

  it('undefined role falls back to the student stat set', () => {
    expect(buildDashboardStats(undefined, { courses: [] })[0]).toEqual({
      label: 'Enrolled courses',
      value: 0,
    });
  });
});
