import type { DashboardStats } from "~/lib/api";
import type { Course } from "~/lib/types";
import { TeachingDashboard } from "./TeachingDashboard";

type DashboardInstructorViewProps = {
  courses: Course[];
  /** Full course count (#1208); `courses` is a bounded page, so the grid discloses the gap. */
  courseTotal?: number;
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardInstructorView({
  courses,
  courseTotal,
  dashboardStats,
}: DashboardInstructorViewProps) {
  // #1043: `courses` is one page of a paged endpoint — counts come from
  // `dashboardStats` (whole-set); array fallbacks cover the pre-rollup frame.
  const stats = [
    { label: "Courses teaching", value: dashboardStats?.yourCourses ?? courses.length },
    {
      label: "Published",
      value: dashboardStats?.publishedCourses ?? courses.filter((c) => c.isPublished).length,
    },
    {
      label: "Unpublished",
      value: dashboardStats?.draftCourses ?? courses.filter((c) => !c.isPublished).length,
    },
    {
      label: "Synced from EduAI",
      value: dashboardStats?.syncedCourses ?? courses.filter((c) => !!c.coreOfferingId).length,
    },
  ];

  return (
    <TeachingDashboard
      sections={[{ kind: "teaching", courses }]}
      courseTotal={courseTotal}
      stats={stats}
      showDrafts
    />
  );
}
