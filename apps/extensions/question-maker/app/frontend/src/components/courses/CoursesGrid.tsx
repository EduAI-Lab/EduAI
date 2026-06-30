import { useMemo } from 'react';
import { CourseCard } from '@eduai/ui';
import { IconBooks } from '@tabler/icons-react';
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

/** Human label for a term+year grouping, e.g. "Winter 2024" or "2024W1 · 2024". */
function termLabel(course: Course): string {
  const term = course.term?.trim();
  const year = course.year ?? undefined;
  if (term && year && !term.includes(String(year))) return `${term} ${year}`;
  if (term) return term;
  if (year) return String(year);
  return 'No term scheduled';
}

/** Sort key so newer terms sort first; undated courses sink to the bottom. */
function termSortKey(course: Course): number {
  const year = course.year ?? 0;
  const t = (course.term ?? '').toLowerCase();
  // Rough intra-year ordering: fall/winter terms after spring/summer.
  const seasonRank = t.includes('w') || t.includes('winter') || t.includes('fall') ? 2 : t ? 1 : 0;
  return year * 10 + seasonRank;
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
};

export function CoursesGrid({
  courses,
  isLoading,
  onSelectCourse,
  emptyHint,
  showDepartment = false,
  tourHighlightCourseId = null,
}: CoursesGridProps) {
  const highlightId = tourHighlightCourseId ?? (courses.length > 0 ? courses[0].id : null);

  // Group courses by term, ordered newest-term first. A single group renders without
  // a heading so small lists stay clean; multiple terms get separator headings.
  const groups = useMemo(() => {
    const byLabel = new Map<string, { label: string; sort: number; items: Course[] }>();
    for (const course of courses) {
      const label = termLabel(course);
      const existing = byLabel.get(label);
      if (existing) existing.items.push(course);
      else byLabel.set(label, { label, sort: termSortKey(course), items: [course] });
    }
    return Array.from(byLabel.values()).sort((a, b) => b.sort - a.sort);
  }, [courses]);

  if (isLoading) {
    return <CardGridSkeleton count={6} columns={3} />;
  }

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={<IconBooks className="size-6" />}
        title="No courses yet"
        description={emptyHint || 'Courses you can access from EduAI Core will appear here.'}
      />
    );
  }

  const renderCard = (course: Course) => {
    const colorIndex = course.id % 5;
    const synced = syncedLabel(course.updatedAt);
    const extraBadges = [course.coreCourseId ? 'EduAI Core' : 'Local', synced].filter(
      (b): b is string => Boolean(b),
    );

    return (
      <div
        key={course.id}
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

  const multipleTerms = groups.length > 1;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label}>
          {multipleTerms && (
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {group.items.length}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map(renderCard)}
          </div>
        </section>
      ))}
    </div>
  );
}
