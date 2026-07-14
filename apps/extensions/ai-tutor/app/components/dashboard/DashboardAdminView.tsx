import { IconBooks, IconBug, IconSettings } from '@tabler/icons-react';
import { DonutChart, PanelCard, type DonutSegment } from '@eduai/ui';
import type { DashboardStats } from '~/lib/api';
import type { AdminBugReportRow, AdminUser, Course } from '~/lib/types';
import { DashboardView, type DashboardQuickAction } from './DashboardView';
import { BugReportTriagePanel } from './BugReportTriagePanel';
import { toDashboardCourseRow } from './dashboard-helpers';

const PUBLISHED_COLOR = 'oklch(0.60 0.15 150)';
const DRAFT_COLOR = 'oklch(0.75 0.15 80)';

const STUDENT_COLOR = 'oklch(0.55 0.14 255)';
const INSTRUCTOR_COLOR = 'oklch(0.62 0.17 295)';
const OTHER_COLOR = 'oklch(0.70 0.03 255)';

type DashboardAdminViewProps = {
  courses: Course[];
  adminUsers: AdminUser[];
  bugReports: AdminBugReportRow[];
  /** Platform-wide rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardAdminView({
  courses,
  adminUsers,
  bugReports,
  dashboardStats,
}: DashboardAdminViewProps) {
  const published = courses.filter((c) => c.isPublished);
  const openReports = bugReports.filter((r) => r.status === 'unhandled');

  const stats = [
    { label: 'Total courses', value: dashboardStats?.totalCourses ?? courses.length },
    { label: 'Published', value: dashboardStats?.publishedCourses ?? published.length },
    { label: 'Platform users', value: dashboardStats?.totalUsers ?? adminUsers.length },
    { label: 'Open bug reports', value: dashboardStats?.openBugReports ?? openReports.length },
  ];

  const statusSegments: DonutSegment[] = [
    { label: 'Published', value: published.length, color: PUBLISHED_COLOR },
    { label: 'Draft', value: courses.length - published.length, color: DRAFT_COLOR },
  ];

  const studentCount = adminUsers.filter((u) => u.role === 'STUDENT').length;
  const instructorCount = adminUsers.filter((u) => u.role === 'INSTRUCTOR' || u.role === 'UNIT_ADMIN').length;
  const otherCount = adminUsers.length - studentCount - instructorCount;
  const roleSegments: DonutSegment[] = [
    { label: 'Students', value: studentCount, color: STUDENT_COLOR },
    { label: 'Instructors', value: instructorCount, color: INSTRUCTOR_COLOR },
    { label: 'Other', value: otherCount, color: OTHER_COLOR },
  ];

  const analytics = (
    <div className="grid gap-4 md:grid-cols-2">
      <PanelCard title="Publish status">
        {courses.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No courses yet.</p>
        ) : (
          <DonutChart data={statusSegments} centerValue={courses.length} centerLabel="Courses" />
        )}
      </PanelCard>
      <PanelCard title="Users by role">
        {adminUsers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <DonutChart data={roleSegments} centerValue={adminUsers.length} centerLabel="Users" />
        )}
      </PanelCard>
    </div>
  );

  const quickActions: DashboardQuickAction[] = [
    {
      label: 'View courses',
      description: 'Browse every course on the platform.',
      href: '/instructor',
      icon: <IconBooks size={16} stroke={1.75} />,
    },
    {
      label: 'Triage bug reports',
      description: openReports.length > 0 ? `${openReports.length} waiting for review.` : 'Nothing waiting for review.',
      href: '/admin',
      icon: <IconBug size={16} stroke={1.75} />,
    },
    {
      label: 'Open settings',
      description: 'Manage your AI providers and accessibility.',
      href: '/settings',
      icon: <IconSettings size={16} stroke={1.75} />,
    },
  ];

  return (
    <DashboardView
      stats={stats}
      analytics={analytics}
      courses={courses.map(toDashboardCourseRow)}
      coursesHref="/instructor"
      leftPanelTitle="All courses"
      quickActions={quickActions}
      rightPanelTitle="Bug reports to triage"
      rightPanel={<BugReportTriagePanel bugReports={bugReports} />}
    />
  );
}
