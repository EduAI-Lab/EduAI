import type { DashboardStats } from "~/lib/api";
import type { Course } from "~/lib/types";
import { TeachingDashboard } from "./TeachingDashboard";

type DashboardUnitAdminViewProps = {
  courses: Course[];
  /** Full course count (#1208); `courses` is a bounded page, so the grid discloses the gap. */
  courseTotal?: number;
  /** Cross-course rollup from `api.dashboardStats()`, scoped server-side to the unit admin's authorized units — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardUnitAdminView({
  courses,
  courseTotal,
  dashboardStats,
}: DashboardUnitAdminViewProps) {
  // #1043: `courses` is one page of a paged endpoint — counts come from
  // `dashboardStats` (whole-set); array fallbacks cover the pre-rollup frame.
  const stats = [
    { label: "Unit courses", value: dashboardStats?.totalCourses ?? courses.length },
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
      sections={[{ kind: "unit", courses }]}
      courseTotal={courseTotal}
      stats={stats}
      showDrafts
    />
  );
}
