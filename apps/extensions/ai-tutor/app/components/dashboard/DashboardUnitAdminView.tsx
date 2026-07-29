import { IconBooks, IconSettings, IconUpload } from '@tabler/icons-react';
import { DonutChart, PanelCard, type DonutSegment } from '@eduai/ui';
import type { DashboardStats } from '~/lib/api';
import type { Course } from '~/lib/types';
import { DashboardView, type DashboardQuickAction } from './DashboardView';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { toDashboardCourseRow } from './dashboard-helpers';

const PUBLISHED_COLOR = 'oklch(0.60 0.15 150)';
const DRAFT_COLOR = 'oklch(0.75 0.15 80)';

type DashboardUnitAdminViewProps = {
  courses: Course[];
  /** Cross-course rollup from `api.dashboardStats()`, scoped server-side to the unit admin's authorized units — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardUnitAdminView({ courses, dashboardStats }: DashboardUnitAdminViewProps) {
  const published = courses.filter((c) => c.isPublished);
  const drafts = courses.filter((c) => !c.isPublished);
  const synced = courses.filter((c) => !!c.coreOfferingId);

  // #1043: `courses` is one page of a paged endpoint — counts come from
  // `dashboardStats` (whole-set); array fallbacks cover the pre-rollup frame.
  const totalCourses = dashboardStats?.totalCourses ?? courses.length;
  const publishedCount = dashboardStats?.publishedCourses ?? published.length;
  const draftCount = dashboardStats?.draftCourses ?? drafts.length;
  const syncedCount = dashboardStats?.syncedCourses ?? synced.length;

  const stats = [
    { label: 'Unit courses', value: totalCourses },
    { label: 'Published', value: publishedCount },
    { label: 'Drafts', value: draftCount },
    { label: 'Synced from EduAI', value: syncedCount },
  ];

  const statusSegments: DonutSegment[] = [
    { label: 'Published', value: publishedCount, color: PUBLISHED_COLOR },
    { label: 'Draft', value: draftCount, color: DRAFT_COLOR },
  ];

  const analytics =
    totalCourses > 0 ? (
      <div className="grid gap-4 md:grid-cols-2">
        <PanelCard title="Publish status">
          <DonutChart data={statusSegments} centerValue={totalCourses} centerLabel="Courses" />
        </PanelCard>
        <PanelCard title="Draft courses">
          <p className="py-6 text-center text-sm text-muted-foreground">
            {draftCount === 0
              ? 'Every course in your units is published.'
              : `${draftCount} of ${totalCourses} unit courses are still in draft.`}
          </p>
        </PanelCard>
      </div>
    ) : undefined;

  const firstDraft = drafts[0];

  const quickActions: DashboardQuickAction[] = [
    {
      label: 'View courses',
      description: 'See every course in your authorized units.',
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
      leftPanelTitle="Unit courses"
      quickActions={quickActions}
      rightPanelTitle="Needs attention"
      rightPanel={<NeedsAttentionPanel courses={courses} coursesBaseHref="/instructor" />}
    />
  );
}
