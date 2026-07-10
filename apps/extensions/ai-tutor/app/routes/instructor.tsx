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
import { useState } from 'react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { IconSchool, IconSearch } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CourseCard,
  CourseListView,
  PageHeading,
  SegmentedControl,
} from '@eduai/ui';
import { accentForCourse, courseCode, courseTerm, courseYear } from '../lib/course-display';
import api from '../lib/api';
import { getEduAiAppUrl } from '../lib/extension-urls';
import type { Course } from '../lib/types';
import type { Route } from './+types/instructor';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';

/**
 * Loads the instructor's course list. The backend scopes /courses to the
 * authenticated user's role, so this is the full set the instructor can act on.
 */
export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

type StatusFilter = 'all' | 'published' | 'draft';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

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
  const [courses] = useState<Course[]>(loaderData.courses ?? []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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
        getSearchText={(course) => `${course.title} ${courseCode(course)}`}
        matchesFilter={(course) => {
          if (statusFilter === 'published') return course.isPublished;
          if (statusFilter === 'draft') return !course.isPublished;
          return true;
        }}
        filters={
          <SegmentedControl
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={STATUS_OPTIONS}
            ariaLabel="Filter by status"
            size="sm"
          />
        }
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
            body="Try a different search term or status filter."
          />
        }
        renderCard={(c) => (
          <CourseCard
            id={String(c.id)}
            code={courseCode(c)}
            name={c.title}
            description={c.description}
            term={courseTerm(c)}
            year={courseYear(c)}
            isPublished={c.isPublished}
            accentColor={accentForCourse(c)}
            extraBadges={c.externalSource === 'EDUAI' ? ['EduAI'] : []}
            href={`/instructor/courses/${c.id}`}
            LinkComponent={Link}
          />
        )}
      />
    </div>
  );
}
