import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardStudentView() {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();

  const courseCount = coursesLoading ? "—" : String(courses.length);
  // AI sessions this week derived from recent chats count as a proxy
  const weeklyChats = chatsLoading ? "—" : String(chats.length);

  const stats: DashboardStatDef[] = [
    { label: "Courses enrolled", value: courseCount },
    { label: "AI sessions / week", value: weeklyChats },
    { label: "Materials accessed", value: "—" },
    { label: "Avg. quiz score", value: "—" },
  ];

  return (
    <DashboardView
      stats={stats}
      courses={courses}
      coursesLoading={coursesLoading}
      leftPanelTitle="Your courses"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
    />
  );
}
