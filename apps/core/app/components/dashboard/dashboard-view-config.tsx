/**
 * @file Consolidates Core's 5 per-role dashboard "view" stubs
 * (dashboard-admin-view.tsx / dashboard-unit-admin-view.tsx /
 * dashboard-instructor-view.tsx / dashboard-ta-view.tsx /
 * dashboard-student-view.tsx) into a single role → config map over the
 * shared `DashboardView`. Mirrors the ai-tutor dashboard's `heroCopy(role,
 * firstName)` pattern (`apps/extensions/ai-tutor/app/routes/dashboard.tsx`).
 *
 * A TA is not a platform `User["role"]` — it's the enrollment-derived
 * `isTA` case computed in the route loader — so it's modeled here as a 6th
 * `EffectiveRole` alongside the 4 real roles ("TA" replacing "STUDENT" when
 * `isTA` is true).
 *
 * The dashboard's data is resolved in the route's SSR loader (#1220), so this
 * file is now purely presentational: `DashboardBody` takes the loader's
 * `DashboardData` and renders the role's `DashboardView`. The old
 * per-role body components that each called `useUsers()`/`useCourses()`/… are
 * gone — with server data there is no conditional hook to work around, so one
 * component covers every role.
 */
import {
  IconUsers,
  IconBook2,
  IconBrain,
  IconBug,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";

import type { DashboardStats } from "~/types/dashboard";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type {
  DashboardCourse,
  DashboardStatDef,
  DashboardQuickAction,
} from "~/components/dashboard/dashboard-view";

/**
 * A platform role, plus "TA" for STUDENT-platform users holding a TA
 * enrollment. `better-auth`'s inferred `User["role"]` is a loosely-typed
 * `string | undefined` (see `lib/auth/server.ts`'s `additionalFields`), so
 * this is spelled out as its own literal union rather than derived from it —
 * callers narrow/fall back to "STUDENT" before indexing `DASHBOARD_CONFIG`.
 */
export type EffectiveRole = "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT" | "TA";

export type DashboardHeroCopy = {
  heading: string;
  subheading: string;
};

/**
 * Data available to every `statBuilder`.
 *
 * #1041: `/api/users` and `/api/courses` are server-paginated now, so a count
 * must come from the server's `total`/`stats`, never from `.length` on the
 * loaded page (which would only ever count the first page). `courses` is still
 * the loaded page — the course-card panel renders it — but every *count* below
 * reads a total. `userTotal`/`activeCourseTotal` are only populated for the
 * roles that show them (ADMIN, UNIT_ADMIN).
 */
export type DashboardStatContext = {
  courses: DashboardCourse[];
  coursesLoading: boolean;
  /** Server-side total for the caller's visible course list (#1041). */
  courseTotal: number;
  stats: DashboardStats | null;
  statsLoading: boolean;
  /** Platform-wide user count from `/api/users` stats — ADMIN only (#1041). */
  userTotal?: number;
  usersLoading?: boolean;
  /** Server-side count of active courses — ADMIN and UNIT_ADMIN only (#1041). */
  activeCourseTotal?: number;
  activeCoursesLoading?: boolean;
};

export type DashboardRoleConfig = {
  statBuilder: (ctx: DashboardStatContext) => DashboardStatDef[];
  leftPanel: "quickActions" | "courses";
  quickActions?: DashboardQuickAction[];
  leftPanelTitle: string;
  /** `greeting` is the precomputed time-of-day greeting ("Good morning", etc). */
  heroCopy: (firstName: string, greeting: string) => DashboardHeroCopy;
};

const ADMIN_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    label: "User management",
    description: "Create, edit, and deactivate platform accounts.",
    href: "/admin/users",
    icon: <IconUsers size={16} stroke={1.75} />,
  },
  {
    label: "AI management",
    description: "Configure providers and models for the platform.",
    href: "/admin/ai-models",
    icon: <IconBrain size={16} stroke={1.75} />,
  },
  {
    label: "Courses",
    description: "View and manage courses across the platform.",
    href: "/courses",
    icon: <IconBook2 size={16} stroke={1.75} />,
  },
  {
    label: "Bug reports",
    description: "Review and triage reports from all EduAI apps.",
    href: "/admin/bug-reports",
    icon: <IconBug size={16} stroke={1.75} />,
  },
];

const UNIT_ADMIN_QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    label: "Courses",
    description: "Create and manage courses in your authorized course codes.",
    href: "/courses",
    icon: <IconBook2 size={16} stroke={1.75} />,
  },
  {
    label: "Course chat",
    description: "Chat within a course for unit-wide support and questions.",
    href: "/chat",
    icon: <IconMessageCircle size={16} stroke={1.75} />,
  },
  {
    label: "Settings",
    description: "Manage your API keys and provider preferences.",
    href: "/settings",
    icon: <IconSettings size={16} stroke={1.75} />,
  },
];

export const DASHBOARD_CONFIG: Record<EffectiveRole, DashboardRoleConfig> = {
  ADMIN: {
    statBuilder: ({ userTotal, usersLoading, activeCourseTotal, activeCoursesLoading, stats, statsLoading }) => [
      { label: "Total users", value: usersLoading ? "—" : String(userTotal ?? 0) },
      { label: "Active courses", value: activeCoursesLoading ? "—" : String(activeCourseTotal ?? 0) },
      { label: "AI sessions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
      { label: "Materials uploaded", value: statsLoading ? "—" : String(stats?.materialCount ?? 0) },
    ],
    leftPanel: "quickActions",
    quickActions: ADMIN_QUICK_ACTIONS,
    leftPanelTitle: "Quick actions",
    heroCopy: () => ({
      heading: "Platform overview",
      subheading: "EduAI platform health and usage at a glance.",
    }),
  },
  UNIT_ADMIN: {
    statBuilder: ({ courseTotal, coursesLoading, activeCourseTotal, activeCoursesLoading, stats, statsLoading }) => [
      { label: "Unit courses", value: coursesLoading ? "—" : String(courseTotal) },
      { label: "Active courses", value: activeCoursesLoading ? "—" : String(activeCourseTotal ?? 0) },
      { label: "Instructors", value: statsLoading ? "—" : String(stats?.instructorCount ?? 0) },
      { label: "AI sessions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
    ],
    leftPanel: "quickActions",
    quickActions: UNIT_ADMIN_QUICK_ACTIONS,
    leftPanelTitle: "Quick actions",
    heroCopy: (firstName) => ({
      heading: `Welcome back, ${firstName}.`,
      subheading: "Your unit courses and administration.",
    }),
  },
  INSTRUCTOR: {
    statBuilder: ({ courseTotal, coursesLoading, stats, statsLoading }) => [
      { label: "Courses teaching", value: coursesLoading ? "—" : String(courseTotal) },
      { label: "Students enrolled", value: statsLoading ? "—" : String(stats?.studentCount ?? 0) },
      { label: "Materials uploaded", value: statsLoading ? "—" : String(stats?.materialCount ?? 0) },
      { label: "AI interactions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
    ],
    leftPanel: "courses",
    leftPanelTitle: "Your courses",
    heroCopy: (firstName) => ({
      heading: `Welcome back, ${firstName}.`,
      subheading: "Your courses and teaching activity.",
    }),
  },
  TA: {
    statBuilder: ({ courseTotal, coursesLoading, stats, statsLoading }) => [
      { label: "Courses assisting", value: coursesLoading ? "—" : String(courseTotal) },
      { label: "Students", value: statsLoading ? "—" : String(stats?.studentCount ?? 0) },
      { label: "Materials", value: statsLoading ? "—" : String(stats?.materialCount ?? 0) },
      { label: "AI sessions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
    ],
    leftPanel: "courses",
    leftPanelTitle: "Assigned courses",
    heroCopy: (firstName, greeting) => ({
      heading: `${greeting}, ${firstName}.`,
      subheading: "Your assigned courses and student activity.",
    }),
  },
  STUDENT: {
    statBuilder: ({ courseTotal, coursesLoading, stats, statsLoading }) => [
      { label: "Courses enrolled", value: coursesLoading ? "—" : String(courseTotal) },
      { label: "AI sessions / week", value: statsLoading ? "—" : String(stats?.chatCountWeek ?? 0) },
      { label: "Materials available", value: statsLoading ? "—" : String(stats?.materialCount ?? 0) },
      { label: "Total sessions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
    ],
    leftPanel: "courses",
    leftPanelTitle: "Your courses",
    heroCopy: (firstName, greeting) => ({
      heading: `${greeting}, ${firstName}.`,
      subheading: "Your AI-powered learning companion.",
    }),
  },
};

/**
 * Renders the dashboard for any role from the route loader's `DashboardData`
 * (#1220). Because the data is already resolved server-side, nothing is loading
 * at first paint — every `*Loading` flag is `false` — and the per-role
 * course/user aggregates the config's `statBuilder` reads come straight off the
 * loader (ADMIN gets `userTotal`; ADMIN/UNIT_ADMIN get `activeCourseTotal`; the
 * course-card roles get `courses` + `courseTotal`). The loader only queries what
 * each role shows, so the per-role gating (#1041) is preserved upstream.
 */
export function DashboardBody({
  effectiveRole,
  data,
}: {
  effectiveRole: EffectiveRole;
  data: DashboardData;
}) {
  const config = DASHBOARD_CONFIG[effectiveRole];
  const ctx: DashboardStatContext = {
    courses: data.courses,
    coursesLoading: false,
    courseTotal: data.courseTotal,
    stats: data.stats,
    statsLoading: false,
    userTotal: data.userTotal,
    usersLoading: false,
    activeCourseTotal: data.activeCourseTotal,
    activeCoursesLoading: false,
  };

  return (
    <DashboardView
      stats={config.statBuilder(ctx)}
      courses={config.leftPanel === "courses" ? data.courses : undefined}
      quickActions={config.leftPanel === "quickActions" ? config.quickActions : undefined}
      leftPanelTitle={config.leftPanelTitle}
      recentChats={data.recentChats}
      analytics={<DashboardAnalytics stats={data.stats} loading={false} />}
    />
  );
}
