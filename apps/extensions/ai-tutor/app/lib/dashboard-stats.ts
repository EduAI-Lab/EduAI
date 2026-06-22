import type { AdminBugReportRow, AdminUser, Course } from '~/lib/types';
import type { DashboardStat } from '~/components/dashboard/DashboardStatGrid';

export function buildStudentDashboardStats(courses: Course[]): DashboardStat[] {
  const inProgress = courses.filter(
    (course) => course.progress && course.progress.completed > 0 && !course.progress.isComplete,
  ).length;

  return [
    { label: 'Enrolled courses', value: courses.length },
    { label: 'In progress', value: inProgress },
    {
      label: 'Completed',
      value: courses.filter((course) => course.progress?.isComplete).length,
    },
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
