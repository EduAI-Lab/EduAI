import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardTaView() {
  // The panel shows a first page of course cards; the count comes from the
  // server's total, not the rows on screen (#1041).
  const { courses, total: courseTotal, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const courseCount = coursesLoading ? "—" : String(courseTotal);
  const studentCount = statsLoading ? "—" : String(stats?.studentCount ?? 0);
  const materialCount = statsLoading ? "—" : String(stats?.materialCount ?? 0);
  const aiSessions = statsLoading ? "—" : String(stats?.chatCount ?? 0);

  const statDefs: DashboardStatDef[] = [
    { label: "Courses assisting", value: courseCount },
    { label: "Students", value: studentCount },
    { label: "Materials", value: materialCount },
    { label: "AI sessions", value: aiSessions },
  ];

  return (
    <DashboardView
      stats={statDefs}
      courses={courses}
      coursesLoading={coursesLoading}
      leftPanelTitle="Assigned courses"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
      analytics={<DashboardAnalytics stats={stats} loading={statsLoading} />}
    />
  );
}