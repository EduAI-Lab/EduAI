import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { IconBooks, IconSearch } from '@tabler/icons-react';
import { Card, CardContent, CourseCard, Input, PageHeading } from '@eduai/ui';
import type { Course } from '../lib/types';
import type { Route } from './+types/student';
import {
  accentForCourse,
  courseCode,
  courseTerm,
  courseYear,
  groupCoursesByTerm,
} from '../lib/course-display';
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

export default function StudentHome({ loaderData }: Route.ComponentProps) {
  const { user } = useLocalUser();
  const courseList = useMemo(() => loaderData.courses ?? [], [loaderData.courses]);
  const [search, setSearch] = useState('');

  const filteredCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return courseList;
    return courseList.filter((course) => {
      const haystack = `${course.title} ${courseCode(course)}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [courseList, search]);
  const termGroups = useMemo(() => groupCoursesByTerm(filteredCourses), [filteredCourses]);
  const multipleTerms = termGroups.length > 1;

  useShellBreadcrumbs([{ label: 'Courses' }]);

  const firstName = firstNameOf(user?.name);
  const heading = firstName ? `${timeOfDayGreeting()}, ${firstName}.` : 'My courses';
  const subheading = 'Continue where you left off or explore your courses.';

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <div data-tour="student-dashboard-header">
        <PageHeading heading={heading} subheading={subheading} />
      </div>

      {courseList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconBooks size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No courses yet</h3>
              <p className="text-sm text-muted-foreground">
                You are not enrolled in any published courses yet. Enrollments sync automatically
                from Core when you sign in.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="relative max-w-sm">
            <IconSearch
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Search courses by title or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search courses"
            />
          </div>

          {filteredCourses.length === 0 ? (
            <Card className="mx-auto max-w-lg">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <IconSearch size={22} aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold text-foreground">No courses match</h3>
                  <p className="text-sm text-muted-foreground">
                    Try a different title or course code.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {termGroups.map((group) => (
                <section key={group.label}>
                  {multipleTerms ? (
                    <div className="mb-3 flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{group.labelLong}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {group.items.length}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((course) => {
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
                      return course.id === filteredCourses[0]?.id ? (
                        <div
                          key={course.id}
                          data-tour="student-course-card-first"
                          data-tour-route={`/student/courses/${course.id}`}
                        >
                          {card}
                        </div>
                      ) : (
                        <div key={course.id}>{card}</div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
