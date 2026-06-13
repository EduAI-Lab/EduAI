import { useCourses } from "~/hooks/api/use-courses";
import { useRecentChats } from "~/hooks/api/use-recent-chats";
import { DashboardView } from "~/components/dashboard/dashboard-view";
import type { DashboardStatDef } from "~/components/dashboard/dashboard-view";

export function DashboardInstructorView() {
  const { courses, loading: coursesLoading } = useCourses();
  const { chats, isLoading: chatsLoading } = useRecentChats();

  // Count unique enrolled students and materials across instructor's courses
  const courseCount = coursesLoading ? "—" : String(courses.length);

  const stats: DashboardStatDef[] = [
    { label: "Courses teaching", value: courseCount },
    { label: "Students enrolled", value: "—" },
    { label: "Materials uploaded", value: "—" },
    { label: "AI interactions", value: "—" },
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
