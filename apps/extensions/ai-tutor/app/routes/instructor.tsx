/**
 * @file Instructor dashboard — the entry point for everything teaching-side.
 *
 * Route: /instructor
 * Auth: INSTRUCTOR (the role string used for instructor accounts)
 * Loads: api.listCourses() — the backend already filters to courses this
 *        instructor has been assigned to, so no additional client filter.
 * Owns: course-card grid and the publish/unpublish toggle for each course.
 * Gotchas:
 *   - Publish toggle uses React 19's useOptimistic so the badge flips
 *     instantly; on server error the base state is restored, which causes
 *     the optimistic value to drop on the next render.
 *   - Courses are created and synced from EduAI Core (source of truth); there
 *     is no in-app import — they appear here automatically.
 *   - Shares the role-scoped RoleDashboard shell with student/admin so all
 *     three dashboards render the same layout.
 * Related: routes/instructor.course.tsx (drilldown), components/PublishStatusButton
 */
import { useMemo, useOptimistic, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconBook2, IconChevronRight, IconSchool } from '@tabler/icons-react';
import { Badge, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@eduai/ui';
import { AtRoleBanner } from '../components/rbac/AtRoleBanner';
import { PermissionGate } from '../components/rbac/PermissionGate';
import { PublishStatusButton } from '../components/PublishStatusButton';
import { useAtPermissions } from '../hooks/useAtPermissions';
import { useLocalUser } from '../hooks/useLocalUser';
import api from '../lib/api';
import { getEduAiAppUrl } from '../lib/extension-urls';
import type { Course } from '../lib/types';
import type { Route } from './+types/instructor';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { RoleDashboard } from '~/components/dashboard/RoleDashboard';
import { buildInstructorDashboardStats } from '~/lib/dashboard-stats';

/**
 * Loads the instructor's course list. The backend scopes /courses to the
 * authenticated user's role, so this is the full set the instructor can act on.
 */
export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

type InstructorCourseCardProps = {
  course: Course;
  onOpen: () => void;
  canPublish: boolean;
  pending: boolean;
  onTogglePublish: () => void;
};

/** One tile in the teaching course grid — mirrors `StudentCourseCard`'s
 *  whole-card-clickable pattern so the two dashboards read as one product.
 *  The publish toggle is a real click target nested in the card, so its
 *  wrapper stops propagation rather than letting the card's own onClick
 *  fire a navigation underneath it. */
function InstructorCourseCard({
  course,
  onOpen,
  canPublish,
  pending,
  onTogglePublish,
}: InstructorCourseCardProps) {
  return (
    <Card
      hoverable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <CardHeader>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex size-11 items-center justify-center rounded-[var(--radius-lg)] bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <IconBook2 size={20} aria-hidden="true" />
          </div>
          {course.externalSource === 'EDUAI' && (
            <Badge variant="secondary" size="sm">
              EduAI
            </Badge>
          )}
        </div>
        <CardTitle className="line-clamp-2 transition-colors group-hover:text-primary">
          {course.title}
        </CardTitle>
        {course.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{course.description}</p>
        ) : null}
      </CardHeader>
      <CardFooter className="justify-between">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-text">
          View course
          <IconChevronRight size={15} aria-hidden="true" />
        </span>
        <PermissionGate allow={canPublish}>
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <PublishStatusButton
              isPublished={course.isPublished}
              pending={pending}
              onClick={onTogglePublish}
            />
          </div>
        </PermissionGate>
      </CardFooter>
    </Card>
  );
}

/**
 * Instructor home. Shows owned courses and the publish toggle for each course.
 * Clicking a card navigates to the course drilldown route. Courses are created
 * and synced from EduAI Core, so there is no in-app import flow.
 */
export default function InstructorHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { user } = useLocalUser();
  const perms = useAtPermissions();
  const [courses, setCourses] = useState<Course[]>(loaderData.courses ?? []);
  const [publishingId, setPublishingId] = useState<number | null>(null);

  const [oCourses, addCourseOpt] = useOptimistic(
    courses,
    (state, patch: (items: Course[]) => Course[]) => patch(state),
  );
  // The teaching dashboard always shows course-scoped stats (Your courses /
  // Published / Draft), including for admins who share this shell — the admin
  // platform stats (Users / bug reports) live on the /admin Bug Reports page.
  const stats = useMemo(() => buildInstructorDashboardStats(oCourses), [oCourses]);

  useShellBreadcrumbs([{ label: 'Courses' }]);

  // Optimistic publish toggle: addCourseOpt flips the badge instantly via
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
    <RoleDashboard
      banner={
        user ? <AtRoleBanner role={user.role} authorizedUnits={user.authorizedUnits} /> : null
      }
      heading="Courses"
      subheading="Manage courses and publish content."
      stats={stats}
    >
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
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {oCourses.map((c) => (
            <InstructorCourseCard
              key={c.id}
              course={c}
              onOpen={() => navigate(`/instructor/courses/${c.id}`)}
              canPublish={perms.canPublishContent}
              pending={publishingId === c.id}
              onTogglePublish={() => {
                if (publishingId === c.id) return;
                togglePublish(c.id, c.isPublished);
              }}
            />
          ))}
        </div>
      )}
    </RoleDashboard>
  );
}
