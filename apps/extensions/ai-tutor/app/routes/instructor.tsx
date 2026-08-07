/**
 * @file Instructor home — the entry point for everything teaching-side.
 *
 * Route: /instructor
 * Auth: INSTRUCTOR (the role string used for instructor accounts)
 * Loads: api.listCourses() — the backend already filters to courses this
 *        instructor has been assigned to, so no additional client filter.
 * Owns: the shared `CourseListView` (search + term grouping). Publishing and
 *        per-course actions live only in EduAI Core — the cards here are
 *        read-only entry points into each course.
 * Gotchas:
 *   - Courses are created and synced from EduAI Core (source of truth); there
 *     is no in-app import — they appear here automatically.
 * Related: routes/instructor.course.tsx (drilldown)
 */
import { Link, redirect, useNavigation } from 'react-router';
import type { ReactNode } from 'react';
import { IconSchool, IconSearch } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CourseCard,
  CourseListView,
  PageHeading,
  buildStatusFilterGroup,
  buildTermFilterGroup,
} from '@eduai/ui';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '../lib/course-display';
import api from '../lib/api';
import { getEduAiAppUrl } from '../lib/extension-urls';
import type { Course } from '../lib/types';
import type { Route } from './+types/instructor';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { PaginationControls } from '~/components/common/PaginationControls';
import {
  MAX_COURSE_SEARCH_LENGTH,
  readCourseListSelection,
  useCourseListFilters,
} from '~/lib/course-list-filters';
import { loadCourseFacets } from '~/lib/course-facets';

/**
 * Loads the instructor's course list. The backend scopes /courses to the
 * authenticated user's role, so this is the full set the instructor can act on.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  // #1043: /courses is paginated. The page comes from the URL (?page=), so the
  // pager is bookmarkable and survives reload.
  // #1208: search and the term/status filters come from the URL too and are
  // applied SERVER-side. They used to be applied by CourseListView over
  // `loaderData.courses` — a single page — so a course matching on page 2
  // rendered "No courses match" while the pager below reported a non-zero
  // total. `total` is now the filtered total, so the pager stays honest.
  const url = new URL(request.url);
  const selection = readCourseListSelection(url);

  // Facets span the caller's whole accessible set, so the dropdowns offer values
  // that only appear further down the list. `loadCourseFacets` caches them (the
  // response doesn't vary with search/filter/page, but the loader re-runs on
  // every one of those) and never rejects, so a facets outage costs the
  // dropdowns rather than the whole page.
  const [page, facets] = await Promise.all([
    api.listCourses({
      page: selection.page,
      search: selection.search || undefined,
      term: selection.filters.term,
      status: selection.filters.status,
    }),
    loadCourseFacets(),
  ]);

  // #1162: guard the upper bound too, not just `page < 1`. A bookmarked or
  // hand-edited `?page=` past the end would otherwise render an empty list
  // while the pager reports a non-zero total. Redirect (rather than silently
  // clamp) so the URL and the rendered page can't disagree. Rebuilding from
  // `url.searchParams` preserves the search/filter params alongside `page`.
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

/** Shared centered empty/no-results card used by the course list. */
function EmptyCourseCard({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
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

export default function InstructorHome({ loaderData }: Route.ComponentProps) {
  // Read straight from loaderData (not local state) so navigating pages via the
  // URL re-renders with the new page rather than freezing the first one.
  const courses = loaderData.courses ?? [];
  const { total, page, pageSize, selection, facets } = loaderData;
  const navigation = useNavigation();
  const { searchDraft, setSearchDraft, setFilter, clearAll, goToPage } =
    useCourseListFilters(selection);

  useShellBreadcrumbs([{ label: 'Courses' }]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading heading="Courses" subheading="Browse your courses and manage their content." />

      <CourseListView<Course>
        courses={courses}
        getKey={(course) => course.id}
        getTermInfo={(course) => ({
          term: courseTerm(course),
          year: courseYear(course),
          startDate: course.startDate ?? null,
        })}
        getSearchText={(course) => `${course.title ?? ""} ${courseCode(course)}`}
        // Controlled: the server already applied search + filters, so the view
        // renders what it is given rather than narrowing the page again.
        searchValue={searchDraft}
        onSearchChange={setSearchDraft}
        searchMaxLength={MAX_COURSE_SEARCH_LENGTH}
        selectedFilters={selection.filters}
        onFilterChange={setFilter}
        onClearAll={clearAll}
        totalCount={total}
        availableValues={{ term: facets.terms, status: facets.statuses }}
        filterGroups={[
          buildStatusFilterGroup<Course>((c) => c.isPublished),
          buildTermFilterGroup<Course>((c) => ({
            term: courseTerm(c),
            year: courseYear(c),
            startDate: c.startDate ?? null,
          })),
        ]}
        emptyState={
          <EmptyCourseCard
            icon={<IconSchool size={22} aria-hidden="true" />}
            title="No courses yet"
            body={
              <>
                Courses are created in{' '}
                <a
                  href={`${getEduAiAppUrl()}/courses`}
                  className="font-medium text-primary-text underline underline-offset-2"
                >
                  EduAI Core
                </a>
                . They sync here automatically once enabled.
              </>
            }
          />
        }
        noResultsState={
          // Core owns title/code/term/status, so with Core down every one of
          // those filters fail-closes to zero rows. Saying "no courses match"
          // there would read as "your course is gone" instead of "search is
          // temporarily degraded".
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
              body="Try a different search term or clear your filters."
            />
          )
        }
        renderCard={(c) => (
          <CourseCard
            id={String(c.id)}
            code={courseCode(c)}
            name={courseName(c)}
            description={c.description}
            term={courseTerm(c)}
            year={courseYear(c)}
            isPublished={c.isPublished}
            accentColor={accentForCourse(c)}
            extraBadges={c.coreOfferingId ? ['EduAI'] : []}
            href={`/instructor/courses/${c.id}`}
            LinkComponent={Link}
          />
        )}
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
