import type { AdminBugReportRow, AdminUser, Course, Role } from '~/lib/types';
import type { DashboardStat } from '~/components/dashboard/DashboardStatGrid';

export function buildStudentDashboardStats(courses: Course[]): DashboardStat[] {
  const inProgress = courses.filter(
    (course) =>
      course.progress &&
      course.progress.completed > 0 &&
      course.progress.completed < course.progress.total,
  ).length;

  const completed = courses.filter(
    (course) =>
      course.progress && course.progress.total > 0 && course.progress.completed >= course.progress.total,
  ).length;

  return [
    { label: 'Enrolled courses', value: courses.length },
    { label: 'In progress', value: inProgress },
    { label: 'Completed', value: completed },
  ];
}

export function buildInstructorDashboardStats(courses: Course[]): DashboardStat[] {
  const published = courses.filter((course) => course.isPublished).length;

  return [
    { label: 'Your courses', value: courses.length },
    { label: 'Published', value: published },
    { label: 'Draft', value: courses.length - published },
  ];
}

export function buildAdminDashboardStats(
  users: AdminUser[],
  courses: Course[],
  bugReports: AdminBugReportRow[],
): DashboardStat[] {
  const openReports = bugReports.filter((report) => report.status !== 'resolved').length;

  return [
    { label: 'Users', value: users.length },
    { label: 'Courses', value: courses.length },
    { label: 'Open bug reports', value: openReports },
    { label: 'Total reports', value: bugReports.length },
  ];
}

/** Data needed to build any role's dashboard stats. Admin-only fields are optional. */
export type DashboardData = {
  courses: Course[];
  users?: AdminUser[];
  bugReports?: AdminBugReportRow[];
};

/**
 * Single role-scoped entry point for dashboard stats so every role's dashboard
 * is built one way. Higher roles encompass lower-role views; admins get the
 * platform stat set, instructor-shell roles get the teaching set, everyone else
 * gets the student set.
 */
export function buildDashboardStats(role: Role | undefined, data: DashboardData): DashboardStat[] {
  if (role === 'ADMIN') {
    return buildAdminDashboardStats(data.users ?? [], data.courses, data.bugReports ?? []);
  }
  if (role === 'INSTRUCTOR' || role === 'UNIT_ADMIN' || role === 'TA') {
    return buildInstructorDashboardStats(data.courses);
  }
  return buildStudentDashboardStats(data.courses);
}
