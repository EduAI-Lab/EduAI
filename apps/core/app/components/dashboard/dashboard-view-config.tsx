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
 * ADMIN is the only role that needs `useUsers()`. Rules-of-hooks forbid
 * calling that hook conditionally inside one component, so instead of one
 * component branching on role, there are two: `DashboardAdminBody` (calls
 * `useUsers()` + the shared hooks) and `DashboardStandardBody` (the shared
 * hooks only, for the other 5 configs). `routes/dashboard.tsx` picks which
 * one to mount — the admin-only hook is never invoked for non-admin roles.
 */
import {
  IconUsers,
  IconBook2,
  IconBrain,
  IconBug,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";

import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useUsers } from "~/hooks/api/use-users";
import { useCourses } from "~/hooks/api/use-courses";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import type { DashboardStats } from "~/hooks/api/use-dashboard-stats";
import type { Course } from "~/hooks/api/use-courses";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef, DashboardQuickAction } from "~/components/dashboard/dashboard-view";

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
  courses: Course[];
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
 * ADMIN only — the sole role that needs `useUsers()`, kept out of the other
 * bodies so the hook is never called (and `/api/users` never fetched) for other
 * roles. Its panel is quick actions, so it never renders course cards; both its
 * counts (#1041) are server totals, so it asks for the smallest page and reads
 * `stats.total` / the active-course `total` rather than a loaded array.
 */
export function DashboardAdminBody() {
  const { stats: userStats, isLoading: usersLoading } = useUsers({ pageSize: 1 });
  const { total: activeCourseTotal, loading: activeCoursesLoading } = useCourses({
    pageSize: 1,
    isActive: true,
  });
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const config = DASHBOARD_CONFIG.ADMIN;
  const ctx: DashboardStatContext = {
    courses: [],
    coursesLoading: false,
    courseTotal: 0,
    stats,
    statsLoading,
    userTotal: userStats.total,
    usersLoading,
    activeCourseTotal,
    activeCoursesLoading,
  };

  return (
    <DashboardView
      stats={config.statBuilder(ctx)}
      quickActions={config.quickActions}
      leftPanelTitle={config.leftPanelTitle}
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}

/**
 * UNIT_ADMIN — like the standard body, but with a second `total`-only read for
 * the active-course count (#1041). Its panel is quick actions too, so it needs
 * course totals, not the loaded page — hence the `pageSize: 1` reads.
 */
export function DashboardUnitAdminBody() {
  const { total: courseTotal, loading: coursesLoading } = useCourses({ pageSize: 1 });
  const { total: activeCourseTotal, loading: activeCoursesLoading } = useCourses({
    pageSize: 1,
    isActive: true,
  });
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const config = DASHBOARD_CONFIG.UNIT_ADMIN;
  const ctx: DashboardStatContext = {
    courses: [],
    coursesLoading,
    courseTotal,
    stats,
    statsLoading,
    activeCourseTotal,
    activeCoursesLoading,
  };

  return (
    <DashboardView
      stats={config.statBuilder(ctx)}
      quickActions={config.quickActions}
      leftPanelTitle={config.leftPanelTitle}
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}

/**
 * INSTRUCTOR, TA, STUDENT — a course-card panel plus a course count. The panel
 * renders the loaded page; the count is the server `total`, not the rows on
 * screen (#1041).
 */
export function DashboardStandardBody({
  effectiveRole,
}: {
  effectiveRole: Exclude<EffectiveRole, "ADMIN" | "UNIT_ADMIN">;
}) {
  const { courses, total: courseTotal, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const config = DASHBOARD_CONFIG[effectiveRole];
  const ctx: DashboardStatContext = { courses, coursesLoading, courseTotal, stats, statsLoading };

  return (
    <DashboardView
      stats={config.statBuilder(ctx)}
      courses={config.leftPanel === "courses" ? courses : undefined}
      coursesLoading={config.leftPanel === "courses" ? coursesLoading : undefined}
      quickActions={config.leftPanel === "quickActions" ? config.quickActions : undefined}
      leftPanelTitle={config.leftPanelTitle}
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}
