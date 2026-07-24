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
import { Link, useNavigation, useSearchParams } from 'react-router';
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

/**
 * Loads the instructor's course list. The backend scopes /courses to the
 * authenticated user's role, so this is the full set the instructor can act on.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  // #1043: /courses is paginated. The page comes from the URL (?page=), so the
  // pager is bookmarkable and survives reload. CourseListView still searches/
  // filters within the loaded page; `total` drives whether a pager shows.
  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get('page'));
  const page = await api.listCourses({
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  });
  return { courses: page.data, total: page.total, page: page.page, pageSize: page.pageSize };
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
  const { total, page, pageSize } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  useShellBreadcrumbs([{ label: 'Courses' }]);

  const goToPage = (nextPage: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(nextPage));
        return next;
      },
      { preventScrollReset: false },
    );
  };

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
                  className="font-medium text-primary underline underline-offset-2"
                >
                  EduAI Core
                </a>
                . They sync here automatically once enabled.
              </>
            }
          />
        }
        noResultsState={
          <EmptyCourseCard
            icon={<IconSearch size={22} aria-hidden="true" />}
            title="No courses match"
            body="Try a different search term."
          />
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
