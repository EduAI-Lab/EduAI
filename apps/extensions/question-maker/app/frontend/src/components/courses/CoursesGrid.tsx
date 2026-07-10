import type { ReactNode } from 'react';
import { CourseCard, CourseListView } from '@eduai/ui';
import { IconBooks, IconSearch } from '@tabler/icons-react';
import type { QmRoleView } from '@/lib/rbac';
import { Course } from '@/types/question';
import { getDepartmentLabel } from '@/lib/units';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardGridSkeleton } from '@/components/shared/Skeletons';

/** Short "last synced" label from a course's Core metadata timestamp. */
function syncedLabel(updatedAt?: string): string | undefined {
  if (!updatedAt) return undefined;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const diffMs = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return 'Synced today';
  if (diffMs < 2 * day) return 'Synced yesterday';
  if (diffMs < 7 * day) return `Synced ${Math.floor(diffMs / day)}d ago`;
  return `Synced ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export type CoursesGridProps = {
  courses: Course[];
  isLoading: boolean;
  onSelectCourse: (course: Course) => void;
  emptyHint?: string;
  showDepartment?: boolean;
  roleView?: QmRoleView;
  currentUserId?: string;
  /** Course card to highlight for guided tour step 1 */
  tourHighlightCourseId?: number | null;
  /** Optional role-specific filter control (e.g. unit-admin's unit picker). */
  filters?: ReactNode;
  /** Optional role-specific predicate applied before the search box. */
  matchesFilter?: (course: Course) => boolean;
};

/**
 * QM's course list. Thin wrapper over the shared `CourseListView` so search,
 * term grouping, and layout read identically to Core and AI Tutor; QM only
 * supplies its click-to-select card and any role-specific filter.
 */
export function CoursesGrid({
  courses,
  isLoading,
  onSelectCourse,
  emptyHint,
  showDepartment = false,
  tourHighlightCourseId = null,
  filters,
  matchesFilter,
}: CoursesGridProps) {
  const highlightId = tourHighlightCourseId ?? (courses.length > 0 ? courses[0].id : null);

  const renderCard = (course: Course) => {
    const colorIndex = course.id % 5;
    const synced = syncedLabel(course.updatedAt);
    const extraBadges = [course.coreCourseId ? 'EduAI Core' : 'Local', synced].filter(
      (b): b is string => Boolean(b),
    );

    return (
      <div
        onClick={(e) => {
          e.preventDefault();
          onSelectCourse(course);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectCourse(course);
          }
        }}
        role="button"
        tabIndex={0}
        data-tour-id={course.id === highlightId ? 'course-select' : undefined}
        data-course-id={course.id}
        className="cursor-pointer rounded-[var(--radius-xl)] focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <CourseCard
          id={String(course.id)}
          code={course.code || course.name}
          name={course.code ? course.name : ''}
          description={course.description ?? undefined}
          term={course.term || ''}
          year={course.year}
          isPublished={true}
          department={showDepartment ? course.department : undefined}
          departmentLabel={
            showDepartment && course.department ? getDepartmentLabel(course.department) : undefined
          }
          extraBadges={extraBadges}
          colorIndex={colorIndex}
          href="#"
        />
      </div>
    );
  };

  return (
    <CourseListView<Course>
      courses={courses}
      isLoading={isLoading}
      loadingSlot={<CardGridSkeleton count={6} columns={3} />}
      getKey={(course) => course.id}
      getTermInfo={(course) => ({ term: course.term, year: course.year })}
      getSearchText={(course) => `${course.name ?? ''} ${course.code ?? ''}`}
      matchesFilter={matchesFilter}
      filters={filters}
      gridClassName="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3"
      emptyState={
        <EmptyState
          icon={<IconBooks className="size-6" />}
          title="No courses yet"
          description={emptyHint || 'Courses you can access from EduAI Core will appear here.'}
        />
      }
      noResultsState={
        <EmptyState
          icon={<IconSearch className="size-6" />}
          title="No courses match"
          description="Try a different search or filter."
        />
      }
      renderCard={renderCard}
    />
  );
}
