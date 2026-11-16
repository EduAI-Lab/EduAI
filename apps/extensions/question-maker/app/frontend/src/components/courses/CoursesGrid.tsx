import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  CourseTile,
  paletteColorAtIndex,
  type CourseTileLink,
  CourseListView,
  buildTermFilterGroup,
  buildDepartmentFilterGroup,
  defaultColorIndexForCourse,
  type CourseFilterGroup,
  EmptyState,
} from "@eduai/ui";
import {
  IconBooks,
  IconClipboardList,
  IconFolders,
  IconLayoutDashboard,
  IconSearch,
  IconStack2,
  type Icon,
} from "@tabler/icons-react";
import { Course } from "@/types/question";
import { getDepartmentLabel } from "@/lib/units";
import { CardGridSkeleton } from "@/components/shared/Skeletons";
import { QM_COURSE_SECTIONS } from "@/components/layout/qmCourseNav";
import type { ActiveTab } from "@/pages/course-detail/courseTabs";

/** Icons for the course sections, matching the command palette's. */
const SECTION_ICONS = {
  overview: IconLayoutDashboard,
  questions: IconStack2,
  banks: IconFolders,
  assessments: IconClipboardList,
} satisfies Partial<Record<ActiveTab, Icon>>;

type CardSection = keyof typeof SECTION_ICONS;

function isCardSection(key: ActiveTab): key is CardSection {
  return key in SECTION_ICONS;
}

/**
 * A card's links: the course sections. Canvas is left out because whether a
 * course is linked to Canvas is only known once its page loads.
 */
function sectionLinks(courseId: number): CourseTileLink[] {
  return QM_COURSE_SECTIONS.flatMap((section) =>
    isCardSection(section.key)
      ? [
          {
            key: section.key,
            label: section.label,
            icon: SECTION_ICONS[section.key],
            href: `/courses/${courseId}?tab=${section.key}`,
          },
        ]
      : [],
  );
}

/** Short "last synced" label from a course's Core metadata timestamp. */
function syncedLabel(updatedAt?: string): string | undefined {
  if (!updatedAt) return undefined;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const diffMs = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "Synced today";
  if (diffMs < 2 * day) return "Synced yesterday";
  if (diffMs < 7 * day) return `Synced ${Math.floor(diffMs / day)}d ago`;
  return `Synced ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

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
 * supplies the course sections on each card and any role-specific filter.
 */
export function CoursesGrid({
  courses,
  isLoading,
  emptyHint,
  showDepartment = false,
  filters,
  matchesFilter,
}: CoursesGridProps) {
  const filterGroups: CourseFilterGroup<Course>[] = [
    buildTermFilterGroup<Course>((c) => ({ term: c.term, year: c.year })),
    ...(showDepartment
      ? [
          buildDepartmentFilterGroup<Course>((c) => c.department, {
            optionLabel: getDepartmentLabel,
          }),
        ]
      : []),
  ];

  const renderCard = (course: Course) => {
    // Cross-platform visual identity: the accent is keyed off the CORE course
    // id (the one identity all three apps share), so the same course renders
    // the same color in Core, AI Tutor, and QM. Local id only as a fallback
    // for legacy unlinked rows.
    const colorIndex = defaultColorIndexForCourse(course.coreCourseId ?? String(course.id));
    const synced = syncedLabel(course.updatedAt);
    const extraBadges = [
      showDepartment && course.department ? getDepartmentLabel(course.department) : undefined,
      course.coreCourseId ? "EduAI Core" : "Local",
      synced,
    ].filter((b): b is string => Boolean(b));

    return (
      // Every card is a tour target: the guided tour (#1754) spotlights the
      // first one on screen and follows it into its workspace, so it matches
      // CourseListView's ordering (current term first) and any active filter.
      <div
        data-tour="course-select"
        data-tour-route={`/courses/${course.id}`}
        data-course-id={course.id}
      >
        <CourseTile
          code={course.code ?? ""}
          title={course.name}
          term={course.term || ""}
          year={course.year ?? null}
          accent={paletteColorAtIndex(colorIndex)}
          href={`/courses/${course.id}?tab=overview`}
          LinkComponent={Link}
          links={sectionLinks(course.id)}
          publishState={course.isPublished ?? undefined}
          extraBadges={extraBadges}
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
      getSearchText={(course) => `${course.name ?? ""} ${course.code ?? ""}`}
      filterGroups={filterGroups}
      matchesFilter={matchesFilter}
      filters={filters}
      gridClassName="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3"
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
