import {
  IconBook2,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";

import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef, DashboardQuickAction } from "~/components/dashboard/dashboard-view";

export function DashboardUnitAdminView() {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const courseCount = coursesLoading ? "—" : String(courses.length);
  const activeCourses = coursesLoading
    ? "—"
    : String(courses.filter((c) => c.isActive).length);
  const instructorCount = statsLoading ? "—" : String(stats?.instructorCount ?? 0);
  const aiSessions = statsLoading ? "—" : String(stats?.chatCount ?? 0);

  const statDefs: DashboardStatDef[] = [
    { label: "Unit courses", value: courseCount },
    { label: "Active courses", value: activeCourses },
    { label: "Instructors", value: instructorCount },
    { label: "AI sessions", value: aiSessions },
  ];

  const quickActions: DashboardQuickAction[] = [
    {
      label: "Courses",
      description: "Create and manage courses in your authorized departments.",
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

  return (
    <DashboardView
      stats={statDefs}
      quickActions={quickActions}
      leftPanelTitle="Quick actions"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}
