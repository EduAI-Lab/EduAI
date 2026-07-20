import {
  IconUsers,
  IconBook2,
  IconBrain,
  IconBug,
} from "@tabler/icons-react";

import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useUsers } from "~/hooks/api/use-users";
import { useCourses } from "~/hooks/api/use-courses";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef, DashboardQuickAction } from "~/components/dashboard/dashboard-view";

const QUICK_ACTIONS: DashboardQuickAction[] = [
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

export function DashboardAdminView() {
  // Both dashboards want aggregates, not rows: ask for the smallest page and
  // read the server's counts (#1041).
  const { stats: userStats, isLoading: usersLoading } = useUsers({ pageSize: 1 });
  const { total: activeCourseCount, loading: coursesLoading } = useCourses({
    pageSize: 1,
    isActive: true,
  });
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const totalUsers = usersLoading ? "—" : String(userStats.total);
  const activeCourses = coursesLoading ? "—" : String(activeCourseCount);
  const aiSessions = statsLoading ? "—" : String(stats?.chatCount ?? 0);
  const materialsUploaded = statsLoading ? "—" : String(stats?.materialCount ?? 0);

  const statDefs: DashboardStatDef[] = [
    { label: "Total users", value: totalUsers },
    { label: "Active courses", value: activeCourses },
    { label: "AI sessions", value: aiSessions },
    { label: "Materials uploaded", value: materialsUploaded },
  ];

  return (
    <DashboardView
      stats={statDefs}
      quickActions={QUICK_ACTIONS}
      leftPanelTitle="Quick actions"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}
