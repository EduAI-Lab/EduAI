import {
  IconUsers,
  IconBook2,
  IconBrain,
  IconBug,
} from "@tabler/icons-react";

import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useUsers } from "~/hooks/api/use-users";
import { useCourses } from "~/hooks/api/use-courses";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import type { DashboardStatDef, DashboardQuickAction } from "~/components/dashboard/dashboard-view";

const QUICK_ACTIONS: DashboardQuickAction[] = [
  {
    label: "User management",
    description: "Create, edit, and deactivate platform accounts.",
    href: "/admin/users",
    color: "var(--color-course-1)",
    icon: <IconUsers size={16} stroke={1.75} />,
  },
  {
    label: "AI management",
    description: "Configure providers and models for the whole platform.",
    href: "/admin/ai-models",
    color: "var(--color-course-3)",
    icon: <IconBrain size={16} stroke={1.75} />,
  },
  {
    label: "Courses",
    description: "View and manage courses across the platform.",
    href: "/courses",
    color: "var(--color-course-2)",
    icon: <IconBook2 size={16} stroke={1.75} />,
  },
  {
    label: "Bug reports",
    description: "Review and triage reports from all EduAI apps.",
    href: "/admin/bug-reports",
    color: "var(--color-course-4)",
    icon: <IconBug size={16} stroke={1.75} />,
  },
];

export function DashboardAdminView() {
  const { users, isLoading: usersLoading } = useUsers();
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();

  const totalUsers = usersLoading ? "—" : String(users.length);
  const activeCourses = coursesLoading ? "—" : String(courses.filter((c) => c.isActive).length);

  const stats: DashboardStatDef[] = [
    { label: "Total users", value: totalUsers },
    { label: "Active courses", value: activeCourses },
    { label: "AI sessions", value: "—" },
    { label: "Storage used", value: "—" },
  ];

  return (
    <DashboardView
      stats={stats}
      quickActions={QUICK_ACTIONS}
      leftPanelTitle="Quick actions"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
    />
  );
}
