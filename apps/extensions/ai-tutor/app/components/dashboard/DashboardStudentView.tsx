import { IconBooks, IconMessageChatbot, IconSettings } from '@tabler/icons-react';
import { DonutChart, MeterBar, PanelCard, type DonutSegment } from '@eduai/ui';
import type { DashboardStats } from '~/lib/api';
import type { Course, SubmissionRow } from '~/lib/types';
import { DashboardView, type DashboardQuickAction } from './DashboardView';
import { ContinueLearningPanel } from './ContinueLearningPanel';
import {
  aggregateProgress,
  completedCourses,
  findResumeCourse,
  inProgressCourses,
  notStartedCourses,
  toDashboardCourseRow,
} from './dashboard-helpers';

const NOT_STARTED_COLOR = 'oklch(0.70 0.03 255)';
const IN_PROGRESS_COLOR = 'oklch(0.75 0.15 80)';
const COMPLETED_COLOR = 'oklch(0.60 0.15 150)';
const PROGRESS_COLOR = 'oklch(0.55 0.16 255)';

type DashboardStudentViewProps = {
  courses: Course[];
  /** Full course count (#1208); `courses` is a bounded page, so the panel discloses the gap. */
  courseTotal?: number;
  submissions: SubmissionRow[];
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardStudentView({ courses, courseTotal, submissions, dashboardStats }: DashboardStudentViewProps) {
  const inProgress = inProgressCourses(courses);
  const completed = completedCourses(courses);
  const notStarted = notStartedCourses(courses);
  const resumeCourse = findResumeCourse(courses);

  const gradedSubmissions = submissions.filter((s) => s.isCorrect !== null && s.isCorrect !== undefined);
  const correctCount = gradedSubmissions.filter((s) => s.isCorrect).length;
  const correctPct =
    gradedSubmissions.length > 0 ? Math.round((correctCount / gradedSubmissions.length) * 100) : null;

  const stats = [
    { label: 'Courses enrolled', value: dashboardStats?.enrolledCourses ?? courses.length },
    { label: 'In progress', value: dashboardStats?.coursesInProgress ?? inProgress.length },
    { label: 'Completed', value: dashboardStats?.coursesCompleted ?? completed.length },
    { label: 'Correct answers', value: correctPct !== null ? `${correctPct}%` : '—' },
  ];

  const { completed: sumCompleted, total: sumTotal } = aggregateProgress(courses);

  const statusSegments: DonutSegment[] = [
    { label: 'Not started', value: notStarted.length, color: NOT_STARTED_COLOR },
    { label: 'In progress', value: inProgress.length, color: IN_PROGRESS_COLOR },
    { label: 'Completed', value: completed.length, color: COMPLETED_COLOR },
  ];
  const coursesWithProgress = notStarted.length + inProgress.length + completed.length;

  const analytics = (
    <div className="grid gap-4 md:grid-cols-2">
      <PanelCard title="Course status">
        {coursesWithProgress === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No enrolled courses yet.</p>
        ) : (
          <DonutChart data={statusSegments} centerValue={coursesWithProgress} centerLabel="Courses" />
        )}
      </PanelCard>
      <PanelCard title="Lessons completed">
        <div className="flex flex-col gap-4 pt-1">
          <MeterBar
            label="Across all courses"
            value={sumCompleted}
            total={Math.max(sumTotal, sumCompleted)}
            color={PROGRESS_COLOR}
            showCount
          />
          <p className="text-xs text-muted-foreground">
            {sumTotal === 0
              ? 'No lessons available yet.'
              : `${sumCompleted} of ${sumTotal} lessons complete.`}
          </p>
        </div>
      </PanelCard>
    </div>
  );

  const quickActions: DashboardQuickAction[] = [
    {
      label: 'View courses',
      description: 'See all your enrolled courses.',
      href: '/student',
      icon: <IconBooks size={16} stroke={1.75} />,
    },
    {
      label: 'Continue learning',
      description: resumeCourse ? `Pick up ${resumeCourse.title}.` : 'Jump back into an activity.',
      href: resumeCourse ? `/student/courses/${resumeCourse.id}` : '/student',
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
      analytics={analytics}
      courses={courses.map(toDashboardCourseRow)}
      coursesHref="/student"
      leftPanelTitle="Your courses"
      quickActions={quickActions}
      rightPanelTitle="Continue learning"
      rightPanel={<ContinueLearningPanel courses={courses} total={courseTotal} coursesBaseHref="/student" />}
    />
  );
}
