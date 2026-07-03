/**
 * @file Admin console for platform stats and bug-report triage.
 *
 * Route: /admin
 * Auth: ADMIN
 * Loads: EduAI API key status, admin users, courses, and bug reports.
 * Owns: read-only platform stat grid + bug-report review.
 * Gotchas:
 *   - User and enrollment management are owned by EduAI Core (synced from
 *     Canvas as source of truth); AI Tutor no longer exposes them here. The
 *     loader still reads user/course counts purely to populate the stat grid.
 *   - `?tab=settings` is preserved as a redirect to /settings; any other
 *     `?tab=` value is ignored (the console now has a single view).
 *   - Shares the role-scoped RoleDashboard shell with student/instructor so all
 *     three dashboards render the same layout.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/admin.js`, `app/lib/api.ts`
 */

import { useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import BugReportsTab from '~/components/admin/BugReportsTab';
import api from '~/lib/api';
import type {
  AdminBugReportRow,
  AdminUser,
  Course,
  EduAiApiKeyStatus,
} from '~/lib/types';
import type { Route } from './+types/admin';
import { requireClientUser } from '~/lib/client-auth';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
import { RoleDashboard } from '~/components/dashboard/RoleDashboard';
import { buildDashboardStats } from '~/lib/dashboard-stats';
import { getApiKeySourceTag, loadAdminSettingsData } from '~/lib/admin-settings';

type AdminLoaderData = {
  status: EduAiApiKeyStatus;
  users: AdminUser[];
  courses: Course[];
  bugReports: AdminBugReportRow[];
};

/**
 * Load the admin console data: API key status (for the source tag), user and
 * course counts (stat grid only), and the bug reports to triage.
 */
export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser('ADMIN');

  const [settingsData, users, courses, bugReports] = await Promise.all([
    loadAdminSettingsData(),
    api.listAdminUsers(),
    api.listAdminCourses(),
    api.listAdminBugReports(),
  ]);

  return {
    status: settingsData.status,
    users,
    courses,
    bugReports,
  } satisfies AdminLoaderData;
}

/**
 * Render the admin control surface: platform stats and bug-report triage.
 *
 * Why: Admins are intentionally isolated from student/instructor workflows.
 * User identity, roles, and enrollments are managed in EduAI Core, so the only
 * system-level task surfaced here is bug-report review.
 */
export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();

  const adminStats = useMemo(
    () =>
      buildDashboardStats('ADMIN', {
        users: loaderData.users,
        courses: loaderData.courses,
        bugReports: loaderData.bugReports,
      }),
    [loaderData.users, loaderData.courses, loaderData.bugReports],
  );

  const sourceTag = getApiKeySourceTag(loaderData.status);

  if (searchParams.get('tab') === 'settings') {
    return <Navigate to="/settings" replace />;
  }

  return (
    <AppShell breadcrumbs={<ShellBreadcrumbs items={[{ label: 'Admin' }]} />}>
      <RoleDashboard
        heading="Admin console"
        subheading="Review platform stats and triage bug reports."
        headingAccessory={<div className={sourceTag.className}>{sourceTag.label}</div>}
        stats={adminStats}
      >
        <BugReportsTab initialReports={loaderData.bugReports} />
      </RoleDashboard>
    </AppShell>
  );
}
