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
  /** Full course count (#1208); `courses` is a bounded page, so the panel discloses the gap. */
  courseTotal?: number;
  /** Cross-course rollup from `api.dashboardStats()` — optional/nullable; falls back to client-derived counts below when absent. */
  dashboardStats?: DashboardStats | null;
};

export function DashboardInstructorView({ courses, courseTotal, dashboardStats }: DashboardInstructorViewProps) {
  const published = courses.filter((c) => c.isPublished);
  const drafts = courses.filter((c) => !c.isPublished);
  const synced = courses.filter((c) => !!c.coreOfferingId);

  // #1043: `courses` is one page of a paged endpoint — counts come from
  // `dashboardStats` (whole-set); array fallbacks cover the pre-rollup frame.
  const totalCourses = dashboardStats?.yourCourses ?? courses.length;
  const publishedCount = dashboardStats?.publishedCourses ?? published.length;
  const draftCount = dashboardStats?.draftCourses ?? drafts.length;
  const syncedCount = dashboardStats?.syncedCourses ?? synced.length;

  const stats = [
    { label: 'Courses teaching', value: totalCourses },
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
              ? 'Everything you teach is published.'
              : `${draftCount} of ${totalCourses} courses are still in draft.`}
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
      rightPanel={<NeedsAttentionPanel courses={courses} total={courseTotal} coursesBaseHref="/instructor" />}
    />
  );
}
