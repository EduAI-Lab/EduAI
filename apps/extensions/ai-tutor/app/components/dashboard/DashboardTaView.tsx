import { IconBooks, IconMessageChatbot, IconSettings } from '@tabler/icons-react';
import type { DashboardStats } from '~/lib/api';
import type { Course, SubmissionRow } from '~/lib/types';
import { DashboardView, type DashboardQuickAction } from './DashboardView';
import { ContinueLearningPanel } from './ContinueLearningPanel';
import { findResumeCourse, toDashboardCourseRow } from './dashboard-helpers';

type DashboardTaViewProps = {
  courses: Course[];
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
export function DashboardTaView({ courses, submissions, dashboardStats }: DashboardTaViewProps) {
  const published = courses.filter((c) => c.isPublished);
  const learningCourses = courses.filter((c) => Boolean(c.progress));
  const resumeCourse = findResumeCourse(courses);

  const gradedSubmissions = submissions.filter((s) => s.isCorrect !== null && s.isCorrect !== undefined);
  const correctCount = gradedSubmissions.filter((s) => s.isCorrect).length;
  const correctPct =
    gradedSubmissions.length > 0 ? Math.round((correctCount / gradedSubmissions.length) * 100) : null;

  const stats = [
    { label: 'Courses assisting', value: dashboardStats?.yourCourses ?? courses.length },
    { label: 'Published', value: dashboardStats?.publishedCourses ?? published.length },
    { label: 'Learning courses', value: learningCourses.length },
    { label: 'Correct answers', value: correctPct !== null ? `${correctPct}%` : '—' },
  ];

  const quickActions: DashboardQuickAction[] = [
    {
      label: 'View courses',
      description: 'See every course you assist with.',
      href: '/instructor',
      icon: <IconBooks size={16} stroke={1.75} />,
    },
    {
      label: 'Continue learning',
      description: resumeCourse ? `Pick up ${resumeCourse.title}.` : 'Resume a course you’re enrolled in.',
      href: resumeCourse ? `/student/courses/${resumeCourse.id}` : '/instructor',
      icon: <IconMessageChatbot size={16} stroke={1.75} />,
    },
    {
      label: 'Open settings',
      description: 'Manage your AI providers and accessibility.',
      href: '/settings',
      icon: <IconSettings size={16} stroke={1.75} />,
    },
  ];

  return (
    <DashboardView
      stats={stats}
      courses={courses.map(toDashboardCourseRow)}
      coursesHref="/instructor"
      leftPanelTitle="Assigned courses"
      quickActions={quickActions}
      rightPanelTitle="Continue learning"
      rightPanel={<ContinueLearningPanel courses={courses} coursesBaseHref="/student" />}
    />
  );
}
