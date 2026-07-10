import { useMemo } from 'react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { IconBooks, IconSearch } from '@tabler/icons-react';
import { Card, CardContent, CourseCard, CourseListView, PageHeading } from '@eduai/ui';
import type { Course } from '../lib/types';
import type { Route } from './+types/student';
import { accentForCourse, courseCode, courseTerm, courseYear } from '../lib/course-display';
import { useLocalUser } from '../hooks/useLocalUser';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
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
        emptyState={
          <EmptyCourseCard
            icon={<IconBooks size={22} aria-hidden="true" />}
            title="No courses yet"
            body="You are not enrolled in any published courses yet. Enrollments sync automatically from Core when you sign in."
          />
        }
        noResultsState={
          <EmptyCourseCard
            icon={<IconSearch size={22} aria-hidden="true" />}
            title="No courses match"
            body="Try a different title or course code."
          />
        }
        renderCard={(course) => {
          const card = (
            <CourseCard
              id={String(course.id)}
              code={courseCode(course)}
              name={course.title}
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
    </div>
  );
}
