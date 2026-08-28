import { IconBooks, IconMessageChatbot, IconSettings } from "@tabler/icons-react";
import type { DashboardStats } from "~/lib/api";
import type { Course, SubmissionRow } from "~/lib/types";
import { DashboardView, type DashboardQuickAction } from "./DashboardView";
import { ContinueLearningPanel } from "./ContinueLearningPanel";
import { findResumeCourse, toDashboardCourseRow } from "./dashboard-helpers";

type DashboardTaViewProps = {
  courses: Course[];
  /** Full course count (#1208); `courses` is a bounded page, so the panel discloses the gap. */
  courseTotal?: number;
  submissions: SubmissionRow[];
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

/**
 * A TA's course list mixes TA-assigned courses (no progress) with any courses
 * they're separately enrolled in as a student (with progress) — see
 * `GET /courses` in `server/src/routes/courses.js`. The stat grid stays
 * teaching-focused; "Continue learning" only lights up when a resumable
 * student-side course actually exists.
 */
export function DashboardTaView({
  courses,
  courseTotal,
  submissions,
  dashboardStats,
}: DashboardTaViewProps) {
  // #1644: `courses` mixes TA-assigned courses (no progress) with courses the
  // same account is separately enrolled in as a student (with progress). Split
  // on that: "Assigned courses" lists only the assisted ones; the enrolled-as-
  // student ones surface in the "Continue learning" panel (scoped internally to
  // in-progress courses), so a course you learn in no longer reads as one you're
  // "assigned" to as staff.
  const assistingCourses = courses.filter((c) => !c.progress);
  const published = assistingCourses.filter((c) => c.isPublished);
  const resumeCourse = findResumeCourse(courses);

  const gradedSubmissions = submissions.filter(
    (s) => s.isCorrect !== null && s.isCorrect !== undefined,
  );
  const correctCount = gradedSubmissions.filter((s) => s.isCorrect).length;
  const correctPct =
    gradedSubmissions.length > 0
      ? Math.round((correctCount / gradedSubmissions.length) * 100)
      : null;

  // Grading-queue depth across the TA's assisted courses (#1626). Prefer the
  // server's cross-course rollup; fall back to the ungraded rows in the loaded
  // `submissions` page when the stats call is unavailable.
  const submissionsToReview =
    dashboardStats?.submissionsToReview ??
    submissions.filter((s) => s.isCorrect === null || s.isCorrect === undefined).length;

  const stats = [
    { label: "Courses assisting", value: dashboardStats?.yourCourses ?? assistingCourses.length },
    { label: "Published", value: dashboardStats?.publishedCourses ?? published.length },
    { label: "To review", value: submissionsToReview },
    { label: "Correct answers", value: correctPct !== null ? `${correctPct}%` : "—" },
  ];

  const quickActions: DashboardQuickAction[] = [
    {
      label: "View courses",
      description: "See every course you assist with.",
      href: "/instructor",
      icon: <IconBooks size={16} stroke={1.75} />,
    },
    {
      label: "Continue learning",
      description: resumeCourse
        ? `Pick up ${resumeCourse.title}.`
        : "Resume a course you’re enrolled in.",
      href: resumeCourse ? `/student/courses/${resumeCourse.id}` : "/instructor",
      icon: <IconMessageChatbot size={16} stroke={1.75} />,
    },
    {
      label: "Open settings",
      description: "Manage your AI providers and accessibility.",
      href: "/settings",
      icon: <IconSettings size={16} stroke={1.75} />,
    },
  ];

  return (
    <DashboardView
      stats={stats}
      courses={assistingCourses.map(toDashboardCourseRow)}
      coursesHref="/instructor"
      leftPanelTitle="Assigned courses"
      quickActions={quickActions}
      rightPanelTitle="Continue learning"
      rightPanel={
        <ContinueLearningPanel courses={courses} total={courseTotal} coursesBaseHref="/student" />
      }
    />
  );
}
