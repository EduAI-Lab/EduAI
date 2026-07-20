import { IconBooks, IconSettings, IconUpload } from '@tabler/icons-react';
import { DonutChart, PanelCard, type DonutSegment } from '@eduai/ui';
import type { DashboardStats } from '~/lib/api';
import type { Course } from '~/lib/types';
import { DashboardView, type DashboardQuickAction } from './DashboardView';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { toDashboardCourseRow } from './dashboard-helpers';

const PUBLISHED_COLOR = 'oklch(0.60 0.15 150)';
const DRAFT_COLOR = 'oklch(0.75 0.15 80)';

type DashboardInstructorViewProps = {
  courses: Course[];
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardInstructorView({ courses, dashboardStats }: DashboardInstructorViewProps) {
  const published = courses.filter((c) => c.isPublished);
  const drafts = courses.filter((c) => !c.isPublished);
  const synced = courses.filter((c) => !!c.coreOfferingId);

  const stats = [
    { label: 'Courses teaching', value: dashboardStats?.yourCourses ?? courses.length },
    { label: 'Published', value: dashboardStats?.publishedCourses ?? published.length },
    { label: 'Drafts', value: dashboardStats?.draftCourses ?? drafts.length },
    { label: 'Synced from EduAI', value: synced.length },
  ];

  const statusSegments: DonutSegment[] = [
    { label: 'Published', value: published.length, color: PUBLISHED_COLOR },
    { label: 'Draft', value: drafts.length, color: DRAFT_COLOR },
  ];

  const analytics =
    courses.length > 0 ? (
      <div className="grid gap-4 md:grid-cols-2">
        <PanelCard title="Publish status">
          <DonutChart data={statusSegments} centerValue={courses.length} centerLabel="Courses" />
        </PanelCard>
        <PanelCard title="Draft courses">
          <p className="py-6 text-center text-sm text-muted-foreground">
            {drafts.length === 0
              ? 'Everything you teach is published.'
              : `${drafts.length} of ${courses.length} courses are still in draft.`}
          </p>
        </PanelCard>
      </div>
    ) : undefined;

  const firstDraft = drafts[0];

  const quickActions: DashboardQuickAction[] = [
    {
      label: 'View courses',
      description: 'See everything you teach.',
      href: '/instructor',
      icon: <IconBooks size={16} stroke={1.75} />,
    },
    {
      label: 'Publish content',
      description: firstDraft ? `Review ${firstDraft.title ?? 'Untitled course'}.` : 'Everything is already published.',
      href: firstDraft ? `/instructor/courses/${firstDraft.id}` : '/instructor',
      icon: <IconUpload size={16} stroke={1.75} />,
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
      coursesHref="/instructor"
      leftPanelTitle="Your courses"
      quickActions={quickActions}
      rightPanelTitle="Needs attention"
      rightPanel={<NeedsAttentionPanel courses={courses} coursesBaseHref="/instructor" />}
    />
  );
}
