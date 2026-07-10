import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardStudentView() {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const courseCount = coursesLoading ? "—" : String(courses.length);
  const weeklyChats = statsLoading ? "—" : String(stats?.chatCountWeek ?? 0);
  const materialsAvailable = statsLoading ? "—" : String(stats?.materialCount ?? 0);

  const statDefs: DashboardStatDef[] = [
    { label: "Courses enrolled", value: courseCount },
    { label: "AI sessions / week", value: weeklyChats },
    { label: "Materials available", value: materialsAvailable },
    { label: "Total sessions", value: statsLoading ? "—" : String(stats?.chatCount ?? 0) },
  ];

  return (
    <DashboardView
      stats={statDefs}
      courses={courses}
      coursesLoading={coursesLoading}
      leftPanelTitle="Your courses"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}