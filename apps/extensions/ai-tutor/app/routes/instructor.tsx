/**
 * @file Instructor home — the entry point for everything teaching-side.
 *
 * Route: /instructor
 * Auth: INSTRUCTOR (the role string used for instructor accounts)
 * Loads: api.listCourses() — the backend already filters to courses this
 *        instructor has been assigned to, so no additional client filter.
 * Owns: the shared-`CourseCard` grid and the publish/unpublish action per course.
 * Gotchas:
 *   - Publish toggle uses React 19's useOptimistic so the card flips instantly;
 *     on server error the base state is restored, which drops the optimistic
 *     value on the next render.
 *   - Courses are created and synced from EduAI Core (source of truth); there
 *     is no in-app import — they appear here automatically.
 * Related: routes/instructor.course.tsx (drilldown)
 */
import { useMemo, useOptimistic, useState } from 'react';
import { Link } from 'react-router';
import { IconSchool, IconSearch } from '@tabler/icons-react';
import { Card, CardContent, CourseCard, Input, PageHeading, SegmentedControl } from '@eduai/ui';
import {
  accentForCourse,
  courseCode,
  courseTerm,
  courseYear,
  groupCoursesByTerm,
} from '../lib/course-display';
import { useAtPermissions } from '../hooks/useAtPermissions';
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

/**
 * Instructor home. Shows taught courses as shared `CourseCard`s with a publish
 * action in each card's menu. Clicking a card navigates to the course drilldown.
 * Courses are created and synced from EduAI Core, so there is no in-app import.
 */
type StatusFilter = 'all' | 'published' | 'draft';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

export default function InstructorHome({ loaderData }: Route.ComponentProps) {
  const perms = useAtPermissions();
  const [courses, setCourses] = useState<Course[]>(loaderData.courses ?? []);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [oCourses, addCourseOpt] = useOptimistic(
    courses,
    (state, patch: (items: Course[]) => Course[]) => patch(state),
  );

  const filteredCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return oCourses.filter((course) => {
      if (statusFilter === 'published' && !course.isPublished) return false;
      if (statusFilter === 'draft' && course.isPublished) return false;
      if (!query) return true;
      const haystack = `${course.title} ${courseCode(course)}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [oCourses, search, statusFilter]);
  const termGroups = useMemo(() => groupCoursesByTerm(filteredCourses), [filteredCourses]);
  const multipleTerms = termGroups.length > 1;

  useShellBreadcrumbs([{ label: 'Courses' }]);

  // Optimistic publish toggle: addCourseOpt flips the card instantly via
  // useOptimistic, then the server response confirms or the catch branch
  // restores the prior published state. Reverting the base state is what
  // causes useOptimistic to drop the now-stale optimistic value.
  const togglePublish = async (courseId: number, currentlyPublished: boolean) => {
    addCourseOpt((items) =>
      items.map((course) =>
        course.id === courseId ? { ...course, isPublished: !currentlyPublished } : course,
      ),
    );
    setPublishingId(courseId);

    try {
      const updated = currentlyPublished
        ? await api.unpublishCourse(courseId)
        : await api.publishCourse(courseId);
      setCourses((prev) => prev.map((course) => (course.id === courseId ? updated : course)));
    } catch (error) {
      console.error('Failed to toggle publish status', error);
      setCourses((prev) =>
        prev.map((course) =>
          course.id === courseId ? { ...course, isPublished: currentlyPublished } : course,
        ),
      );
    } finally {
      setPublishingId((current) => (current === courseId ? null : current));
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <PageHeading heading="Courses" subheading="Manage your courses and publish content." />

      {oCourses.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconSchool size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No courses yet</h3>
              <p className="text-sm text-muted-foreground">
                Courses are created in{' '}
                <a
                  href={`${getEduAiAppUrl()}/courses`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  EduAI Core
                </a>
                . They sync here automatically once enabled.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm sm:flex-1">
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
            <SegmentedControl
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={STATUS_OPTIONS}
              ariaLabel="Filter by status"
              size="sm"
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
                    Try a different search term or status filter.
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
                    {group.items.map((c) => (
                      <CourseCard
                        key={c.id}
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
                        actions={
                          perms.canPublishContent
                            ? {
                                showPublish: true,
                                isPublished: c.isPublished,
                                onPublishToggle: () => {
                                  if (publishingId !== c.id) togglePublish(c.id, c.isPublished);
                                },
                                publishDisabled: publishingId === c.id,
                                publishDisabledReason:
                                  publishingId === c.id ? 'Updating…' : undefined,
                              }
                            : undefined
                        }
                      />
                    ))}
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
