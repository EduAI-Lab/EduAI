import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { useDashboardStats } from "~/hooks/api/use-dashboard-stats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import { DashboardAnalytics } from "~/components/dashboard/dashboard-analytics";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardInstructorView() {
  // The panel shows a first page of course cards; the count comes from the
  // server's total, not the rows on screen (#1041).
  const { courses, total: courseTotal, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const courseCount = coursesLoading ? "—" : String(courseTotal);
  const studentsEnrolled = statsLoading ? "—" : String(stats?.studentCount ?? 0);
  const materialsUploaded = statsLoading ? "—" : String(stats?.materialCount ?? 0);
  const aiInteractions = statsLoading ? "—" : String(stats?.chatCount ?? 0);

  const statDefs: DashboardStatDef[] = [
    { label: "Courses teaching", value: courseCount },
    { label: "Students enrolled", value: studentsEnrolled },
    { label: "Materials uploaded", value: materialsUploaded },
    { label: "AI interactions", value: aiInteractions },
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
