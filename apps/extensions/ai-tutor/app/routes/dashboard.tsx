/**
 * @file Dashboard — the shared, role-aware landing page every AI Tutor role
 * lands on after sign-in (issue #938; AI Tutor was the only EduAI extension
 * without one). Mirrors Core's `/dashboard` (`apps/core/app/routes/dashboard.tsx`)
 * and QM's `/dashboard`: a greeting hero, a real-data stat grid, an optional
 * analytics row, then a 2-column body (your courses + quick actions / a
 * role-specific resume-or-attention panel).
 *
 * Route: /dashboard
 * Auth: any of the five supported roles.
 * Loads: `api.listCourses()` for everyone; `api.mySubmissions()` for
 *   STUDENT/TA (their own graded-answer history); `api.listAdminUsers()` +
 *   `api.listAdminBugReports()` for ADMIN only (used for the platform-users
 *   stat and the bug-report triage panel); `api.dashboardStats()` for
 *   everyone — an authoritative, role-aware cross-course rollup backed by
 *   real tables (see `DashboardStats` in `~/lib/api`). Its fields are
 *   optional and the endpoint can fail entirely (not yet universally rolled
 *   out); callers must fall back to the client-derived stat when a field is
 *   missing, and the whole loader must not fail if this one call does — see
 *   the `.catch(() => null)` below. No metric is fabricated — a stat is only
 *   shown when a real value (server rollup or client derivation) backs it
 *   (see per-role view files).
 * Owns: routing/derivation only — presentation lives in `~/components/dashboard/*`.
 */
import type { ReactNode } from 'react';
import { PageHeading } from '@eduai/ui';
import type { Route } from './+types/dashboard';
import api, { type DashboardStats } from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import type { AdminBugReportRow, AdminUserPage, Course, Role, SubmissionRow } from '~/lib/types';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { useLocalUser } from '~/hooks/useLocalUser';
import { DashboardStudentView } from '~/components/dashboard/DashboardStudentView';
import { DashboardTaView } from '~/components/dashboard/DashboardTaView';
import { DashboardInstructorView } from '~/components/dashboard/DashboardInstructorView';
import { DashboardUnitAdminView } from '~/components/dashboard/DashboardUnitAdminView';
import { DashboardAdminView } from '~/components/dashboard/DashboardAdminView';
import { firstNameOf, timeOfDayGreeting } from '~/components/dashboard/dashboard-helpers';

const SUPPORTED_ROLES: Role[] = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA', 'STUDENT'];

type DashboardLoaderData = {
  role: Role;
  courses: Course[];
  submissions: SubmissionRow[];
  adminUsers: AdminUserPage | null;
  adminBugReports: AdminBugReportRow[];
  /** `null` when the rollup endpoint isn't available yet or the call failed — views fall back to client-derived stats. */
  dashboardStats: DashboardStats | null;
};

export async function clientLoader(_: Route.ClientLoaderArgs) {
  const user = await requireClientUser(SUPPORTED_ROLES);

  const wantsSubmissions = user.role === 'STUDENT' || user.role === 'TA';
  const isAdmin = user.role === 'ADMIN';

  const [courses, submissions, adminUsers, adminBugReports, dashboardStats] = await Promise.all([
    api.listCourses() as Promise<Course[]>,
    wantsSubmissions ? (api.mySubmissions() as Promise<SubmissionRow[]>) : Promise.resolve([]),
    // #1041: one page plus Core's platform-wide `stats`, instead of the whole
    // user table the role breakdown used to be computed from.
    isAdmin
      ? (api.listAdminUsers({ pageSize: 1 }) as Promise<AdminUserPage>)
      : Promise.resolve(null),
    isAdmin ? (api.listAdminBugReports() as Promise<AdminBugReportRow[]>) : Promise.resolve([]),
    // The rollup endpoint is a data-source upgrade, not a hard dependency —
    // never let it fail the whole dashboard load.
    api.dashboardStats().catch(() => null),
  ]);

  return {
    role: user.role,
    courses,
    submissions,
    adminUsers,
    adminBugReports,
    dashboardStats,
  } satisfies DashboardLoaderData;
}

function heroCopy(role: Role, firstName: string | null): { heading: string; subheading: string } {
  switch (role) {
    case 'ADMIN':
      return {
        heading: 'Platform overview',
        subheading: 'AI Tutor usage, courses, and bug reports at a glance.',
      };
    case 'UNIT_ADMIN':
      return {
        heading: firstName ? `Welcome back, ${firstName}.` : 'Welcome back.',
        subheading: "Your unit's courses and administration.",
      };
    case 'INSTRUCTOR':
      return {
        heading: firstName ? `Welcome back, ${firstName}.` : 'Welcome back.',
        subheading: 'Your courses and teaching activity.',
      };
    case 'TA':
      return {
        heading: firstName ? `${timeOfDayGreeting()}, ${firstName}.` : timeOfDayGreeting(),
        subheading: 'Your assigned courses and student activity.',
      };
    case 'STUDENT':
    default:
      return {
        heading: firstName ? `${timeOfDayGreeting()}, ${firstName}.` : timeOfDayGreeting(),
        subheading: 'Continue where you left off or explore your courses.',
      };
  }
}

export default function DashboardHome({ loaderData }: Route.ComponentProps) {
  const { user } = useLocalUser();
  const { role, courses, submissions, adminUsers, adminBugReports, dashboardStats } = loaderData;

  useShellBreadcrumbs([{ label: 'Dashboard' }]);

  const { heading, subheading } = heroCopy(role, firstNameOf(user?.name));

  let content: ReactNode;
  switch (role) {
    case 'ADMIN':
      content = (
        <DashboardAdminView
          courses={courses}
          adminUsers={adminUsers}
          bugReports={adminBugReports}
          dashboardStats={dashboardStats}
        />
      );
      break;
    case 'UNIT_ADMIN':
      content = <DashboardUnitAdminView courses={courses} dashboardStats={dashboardStats} />;
      break;
    case 'INSTRUCTOR':
      content = <DashboardInstructorView courses={courses} dashboardStats={dashboardStats} />;
      break;
    case 'TA':
      content = (
        <DashboardTaView courses={courses} submissions={submissions} dashboardStats={dashboardStats} />
      );
      break;
    case 'STUDENT':
    default:
      content = (
        <DashboardStudentView
          courses={courses}
          submissions={submissions}
          dashboardStats={dashboardStats}
        />
      );
      break;
  }

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading heading={heading} subheading={subheading} />
      {content}
    </div>
  );
}
