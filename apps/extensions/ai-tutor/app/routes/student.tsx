import { useMemo } from 'react';
import { Link, redirect, useNavigation } from 'react-router';
import type { ReactNode } from 'react';
import { IconBooks, IconSearch } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CourseCard,
  CourseListView,
  PageHeading,
  buildTermFilterGroup,
  type CourseFilterGroup,
} from '@eduai/ui';
import type { Course } from '../lib/types';
import type { Route } from './+types/student';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '../lib/course-display';
import { useLocalUser } from '../hooks/useLocalUser';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { PaginationControls } from '~/components/common/PaginationControls';
import {
  MAX_COURSE_SEARCH_LENGTH,
  readCourseListSelection,
  useCourseListFilters,
} from '~/lib/course-list-filters';
import { loadCourseFacets } from '~/lib/course-facets';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  // #1208: search, term and progress come from the URL and are applied
  // SERVER-side, so they span every enrolled course rather than the loaded page.
  // This route previously requested one unbounded-in-practice page and rendered
  // no pager at all — fine while enrolment counts stayed under the page size,
  // but a filtered result set would still have truncated silently at 200.
  const url = new URL(request.url);
  const selection = readCourseListSelection(url);

  const [page, facets] = await Promise.all([
    api.listCourses({
      page: selection.page,
      search: selection.search || undefined,
      term: selection.filters.term,
      progress: selection.filters.progress,
    }),
    // Cached + never-rejecting: see the note in routes/instructor.tsx. The
    // loader re-runs on every keystroke, and a facets failure must not take the
    // enrolled-course list down with it.
    loadCourseFacets(),
  ]);

  // Same upper-bound guard as the instructor list (#1162): rebuild from
  // `url.searchParams` so the search/filter params survive the redirect.
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (selection.page > lastPage) {
    url.searchParams.set('page', String(lastPage));
    throw redirect(`${url.pathname}${url.search}`);
  }

  return {
    courses: page.data,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    selection,
    facets,
  };
}

/** Time-of-day greeting for the page heading — mirrors EduAI Core's dashboard
 *  hero (`apps/core/app/routes/dashboard.tsx`) so the two apps read as one
 *  product rather than two differently-voiced tools. */
function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only, same "Dr. First Last" edge case Core's greeting handles. */
function firstNameOf(name: string | undefined): string | null {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return null;
  return parts.length === 3 && parts[0]!.endsWith('.') ? parts[1]! : parts[0]!;
}

/** Progress surfaced as a single accent badge on the shared card, rather than a
 *  bespoke body/footer the platform's other course cards don't have. */
function progressBadges(course: Course): string[] {
  const p = course.progress;
  if (!p || p.total <= 0 || p.completed <= 0) return [];
  if (p.completed >= p.total) return ['Completed'];
  return [`${Math.round(p.percentage)}% complete`];
}

/**
 * Bucket a course by how far the student has progressed through it.
 *
 * #1208: this is the definition of record for the buckets, but it is no longer
 * what filters — `?progress=` is applied server-side (`progressBucket` in
 * `server/src/services/progressCalculation.js`) so it spans every enrolled
 * course, not the loaded page. `getValue` is kept exported-by-use here because
 * unit tests on both sides pin the two implementations to the same four cases;
 * if they drift, the dropdown would label a course differently from the filter
 * that selected it.
 */
export const PROGRESS_FILTER: CourseFilterGroup<Course> = {
  id: 'progress',
  label: 'Progress',
  getValue: (course) => {
    const p = course.progress;
    if (!p || p.total <= 0) return null;
    if (p.completed <= 0) return 'not-started';
    if (p.completed >= p.total) return 'completed';
    return 'in-progress';
  },
  options: [
    { value: 'not-started', label: 'Not started' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
  ],
};

/** Shared centered empty/no-results card used by the course list. */
function EmptyCourseCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StudentHome({ loaderData }: Route.ComponentProps) {
  const { user } = useLocalUser();
  const courseList = useMemo(() => loaderData.courses ?? [], [loaderData.courses]);
  const { total, page, pageSize, selection, facets } = loaderData;
  const navigation = useNavigation();
  const { searchDraft, setSearchDraft, setFilter, clearAll, goToPage } =
    useCourseListFilters(selection);

  useShellBreadcrumbs([{ label: 'Courses' }]);

  const firstName = firstNameOf(user?.name);
  const heading = firstName ? `${timeOfDayGreeting()}, ${firstName}.` : 'My courses';
  const subheading = 'Continue where you left off or explore your courses.';

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <div data-tour="student-dashboard-header">
        <PageHeading heading={heading} subheading={subheading} />
      </div>

      <CourseListView<Course>
        courses={courseList}
        getKey={(course) => course.id}
        getTermInfo={(course) => ({
          term: courseTerm(course),
          year: courseYear(course),
          startDate: course.startDate ?? null,
        })}
        getSearchText={(course) => `${course.title} ${courseCode(course)}`}
        // Controlled: search, term and progress were applied server-side across
        // every enrolled course, so the view must not narrow the page again.
        searchValue={searchDraft}
        onSearchChange={setSearchDraft}
        searchMaxLength={MAX_COURSE_SEARCH_LENGTH}
        selectedFilters={selection.filters}
        onFilterChange={setFilter}
        onClearAll={clearAll}
        totalCount={total}
        availableValues={{ term: facets.terms, progress: facets.progress }}
        filterGroups={[
          buildTermFilterGroup<Course>((c) => ({
            term: courseTerm(c),
            year: courseYear(c),
            startDate: c.startDate ?? null,
          })),
          PROGRESS_FILTER,
        ]}
        emptyState={
          <EmptyCourseCard
            icon={<IconBooks size={22} aria-hidden="true" />}
            title="No courses yet"
            body="You are not enrolled in any published courses yet. Enrollments sync automatically from Core when you sign in."
          />
        }
        noResultsState={
          // See routes/instructor.tsx: with Core down every catalog-side filter
          // fail-closes to zero rows, so "no matches" would misreport a degraded
          // search as a missing course.
          facets.coreUnavailable ? (
            <EmptyCourseCard
              icon={<IconSearch size={22} aria-hidden="true" />}
              title="Search is unavailable"
              body="EduAI Core can't be reached right now, so courses can't be searched or filtered. Clear your filters to see your full list."
            />
          ) : (
            <EmptyCourseCard
              icon={<IconSearch size={22} aria-hidden="true" />}
              title="No courses match"
              body="Try a different title or course code."
            />
          )
        }
        renderCard={(course) => {
          const card = (
            <CourseCard
              id={String(course.id)}
              code={courseCode(course)}
              name={courseName(course)}
              description={course.description}
              term={courseTerm(course)}
              year={courseYear(course)}
              isPublished={course.isPublished}
              accentColor={accentForCourse(course)}
              extraBadges={progressBadges(course)}
              href={`/student/courses/${course.id}`}
              LinkComponent={Link}
            />
          );
          // Preserve the guided-tour target the old first-card carried.
          return course.id === courseList[0]?.id ? (
            <div
              data-tour="student-course-card-first"
              data-tour-route={`/student/courses/${course.id}`}
            >
              {card}
            </div>
          ) : (
            card
          );
        }}
      />

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
        disabled={navigation.state === 'loading'}
      />
    </div>
  );
}
