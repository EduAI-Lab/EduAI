import type { ReactNode } from "react";
import {
  CourseListView,
  buildStatusFilterGroup,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
  type CourseFilterGroup,
  EmptyState,
} from "@eduai/ui";
import { IconBooks, IconSearch } from "@tabler/icons-react";
import { Course } from "@/types/question";
import { getDepartmentLabel } from "@/lib/units";
import { CardGridSkeleton } from "@/components/shared/Skeletons";
import { useQmPermissions } from "@/hooks/useQmPermissions";
import { useCanvasLinks } from "@/hooks/useCanvasLinks";
import {
  QmCourseGridCard,
  QmCourseListHeader,
  QmCourseListRow,
  QmCourseViewToggle,
  qmCourseLinks,
  useQmCourseView,
} from "./QmCourseCard";

export type CoursesGridProps = {
  courses: Course[];
  isLoading: boolean;
  emptyHint?: string;
  showDepartment?: boolean;
  /** Optional role-specific filter control (e.g. unit-admin's unit picker). */
  filters?: ReactNode;
  /** Optional role-specific predicate applied before the search box. */
  matchesFilter?: (course: Course) => boolean;
};

/**
 * QM's course list. Thin wrapper over the shared `CourseListView` so search,
 * term grouping, and layout read identically to Core and AI Tutor; QM only
 * supplies its Canvas-style card/row and any role-specific filter.
 */
export function CoursesGrid({
  courses,
  isLoading,
  emptyHint,
  showDepartment = false,
  filters,
  matchesFilter,
}: CoursesGridProps) {
  const [view, setView] = useQmCourseView();
  const { canManageCanvas } = useQmPermissions();
  // The list view renders no Canvas links, so it makes no lookups.
  const linked = useCanvasLinks(
    courses.map((c) => c.id),
    canManageCanvas && view === "card",
  );
  const filterGroups: CourseFilterGroup<Course>[] = [
    {
      ...buildStatusFilterGroup<Course>((c) => c.isPublished === true),
      // Courses with no known status stay out of both options instead of reading "Unpublished".
      getValue: (c) => (c.isPublished == null ? null : c.isPublished ? "published" : "draft"),
    },
    buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
    ...(showDepartment
      ? [
          buildDepartmentFilterGroup<Course>((c) => c.department, {
            optionLabel: getDepartmentLabel,
          }),
        ]
      : []),
  ];

  const renderCard = (course: Course) =>
    view === "list" ? (
      <QmCourseListRow course={course} />
    ) : (
      <QmCourseGridCard
        course={course}
        links={qmCourseLinks(course, linked.has(course.id))}
        showDepartment={showDepartment}
      />
    );

  return (
    <CourseListView<Course>
      courses={courses}
      isLoading={isLoading}
      loadingSlot={<CardGridSkeleton count={6} columns={3} />}
      getKey={(course) => course.id}
      getTermInfo={(course) => ({ term: course.term, year: course.year })}
      getSearchText={(course) => `${course.name ?? ""} ${course.code ?? ""}`}
      filterGroups={filterGroups}
      matchesFilter={matchesFilter}
      filters={
        <>
          {filters}
          <div className="sm:ml-auto">
            <QmCourseViewToggle view={view} onChange={setView} />
          </div>
        </>
      }
      toolbarClassName="rounded-lg border border-border bg-card p-2.5 shadow-xs"
      sectionHeader={view === "list" ? <QmCourseListHeader /> : undefined}
      gridClassName={
        view === "list"
          ? "overflow-hidden rounded-lg border border-border bg-card"
          : "grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3"
      }
      emptyState={
        <div data-tour="qm-courses-empty">
          <EmptyState
            bare={false}
            icon={<IconBooks className="size-6" />}
            title="No courses yet"
            description={emptyHint || "Courses you can access from EduAI Core will appear here."}
          />
        </div>
      }
      noResultsState={
        <EmptyState
          bare={false}
          icon={<IconSearch className="size-6" />}
          title="No courses match"
          description="Try a different search or filter."
        />
      }
      renderCard={renderCard}
    />
  );
}
