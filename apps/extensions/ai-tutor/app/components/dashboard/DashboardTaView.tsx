import type { DashboardStats } from "~/lib/api";
import type { Course, SubmissionRow } from "~/lib/types";
import { TeachingDashboard } from "./TeachingDashboard";

type DashboardTaViewProps = {
  courses: Course[];
  /** Full course count (#1208); `courses` is a bounded page, so the grid discloses the gap. */
  courseTotal?: number;
  submissions: SubmissionRow[];
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

/**
 * #1644: a TA's course list mixes TA-assigned courses (no progress) with any
 * courses the same account is separately enrolled in as a student (with
 * progress) — see `GET /courses` in `server/src/routes/courses.js`. They get
 * separate sections, so a course you learn in never reads as one you assist.
 */
export function DashboardTaView({
  courses,
  courseTotal,
  submissions,
  dashboardStats,
}: DashboardTaViewProps) {
  const assistingCourses = courses.filter((c) => !c.progress);
  const takingCourses = courses.filter((c) => c.progress);

  const graded = submissions.filter((s) => s.isCorrect !== null && s.isCorrect !== undefined);
  const correctPct =
    graded.length > 0
      ? Math.round((graded.filter((s) => s.isCorrect).length / graded.length) * 100)
      : null;

  // Grading-queue depth across the TA's assisted courses (#1626). Prefer the
  // server's rollup; fall back to the ungraded rows in the loaded page.
  const submissionsToReview =
    dashboardStats?.submissionsToReview ??
    submissions.filter((s) => s.isCorrect === null || s.isCorrect === undefined).length;

  const stats = [
    { label: "Courses assisting", value: dashboardStats?.yourCourses ?? assistingCourses.length },
    {
      label: "Published",
      value:
        dashboardStats?.publishedCourses ?? assistingCourses.filter((c) => c.isPublished).length,
    },
    { label: "To review", value: submissionsToReview },
    { label: "Correct answers", value: correctPct !== null ? `${correctPct}%` : "—" },
  ];

  return (
    <TeachingDashboard
      sections={[
        { kind: "assisting", courses: assistingCourses },
        { kind: "taking", courses: takingCourses },
      ]}
      courseTotal={courseTotal}
      stats={stats}
      showDrafts={false}
    />
  );
}
