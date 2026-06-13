import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardTaView() {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();

  const courseCount = coursesLoading ? "—" : String(courses.length);

  const stats: DashboardStatDef[] = [
    { label: "Courses assisting", value: courseCount },
    { label: "Students", value: "—" },
    { label: "Materials", value: "—" },
    { label: "AI sessions", value: "—" },
  ];

  return (
    <DashboardView
      stats={stats}
      courses={courses}
      coursesLoading={coursesLoading}
      leftPanelTitle="Assigned courses"
      recentChats={chats}
      recentChatsLoading={chatsLoading}
    />
  );
}
