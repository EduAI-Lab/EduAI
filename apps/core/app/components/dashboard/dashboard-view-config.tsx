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
import type { PlatformUser } from "~/hooks/api/types";
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

/** Data available to every `statBuilder` — `users`/`usersLoading` are only populated for ADMIN. */
export type DashboardStatContext = {
  courses: Course[];
  coursesLoading: boolean;
  stats: DashboardStats | null;
  statsLoading: boolean;
  users?: PlatformUser[];
  usersLoading?: boolean;
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
    statBuilder: ({ users, usersLoading, courses, coursesLoading, stats, statsLoading }) => [
      { label: "Total users", value: usersLoading ? "—" : String(users?.length ?? 0) },
      { label: "Active courses", value: coursesLoading ? "—" : String(courses.filter((c) => c.isActive).length) },
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
    statBuilder: ({ courses, coursesLoading, stats, statsLoading }) => [
      { label: "Unit courses", value: coursesLoading ? "—" : String(courses.length) },
      { label: "Active courses", value: coursesLoading ? "—" : String(courses.filter((c) => c.isActive).length) },
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
    statBuilder: ({ courses, coursesLoading, stats, statsLoading }) => [
      { label: "Courses teaching", value: coursesLoading ? "—" : String(courses.length) },
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
    statBuilder: ({ courses, coursesLoading, stats, statsLoading }) => [
      { label: "Courses assisting", value: coursesLoading ? "—" : String(courses.length) },
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
    statBuilder: ({ courses, coursesLoading, stats, statsLoading }) => [
      { label: "Courses enrolled", value: coursesLoading ? "—" : String(courses.length) },
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

/** ADMIN only — the sole role that needs `useUsers()`, kept out of `DashboardStandardBody`
 * so the hook is never called (and `/api/users` never fetched) for other roles. */
export function DashboardAdminBody() {
  const { users, isLoading: usersLoading } = useUsers();
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const config = DASHBOARD_CONFIG.ADMIN;
  const ctx: DashboardStatContext = { courses, coursesLoading, stats, statsLoading, users, usersLoading };

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

/** Every other role — UNIT_ADMIN, INSTRUCTOR, TA, STUDENT. */
export function DashboardStandardBody({ effectiveRole }: { effectiveRole: Exclude<EffectiveRole, "ADMIN"> }) {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const config = DASHBOARD_CONFIG[effectiveRole];
  const ctx: DashboardStatContext = { courses, coursesLoading, stats, statsLoading };

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
