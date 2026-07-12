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
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
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
    <AppShell breadcrumbs={<ShellBreadcrumbs items={[{ label: 'Courses' }]} />}>
      <RoleDashboard
        banner={
          user ? <AtRoleBanner role={user.role} authorizedUnits={user.authorizedUnits} /> : null
        }
        heading="Courses"
        subheading="Manage courses and publish content."
        stats={stats}
      >
        {oCourses.length === 0 ? (
          <div className="animate-fade-up delay-150">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-12 text-center max-w-lg mx-auto">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-secondary flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">No courses yet</h2>
              <p className="text-muted-foreground text-sm">
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
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {oCourses.map((c, index) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/instructor/courses/${c.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/instructor/courses/${c.id}`);
                  }
                }}
                className="group rounded-lg border bg-card text-card-foreground shadow-sm p-6 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 glow flex flex-col animate-fade-up focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{ animationDelay: `${150 + index * 50}ms` }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                  </div>

                  {c.externalSource === 'EDUAI' && <span className="tag tag-primary">EduAI</span>}
                </div>

                {/* Course info */}
                <div className="flex-1 mb-4">
                  <h3 className="text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {c.title}
                  </h3>
                  {c.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                  )}
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                    <span className="group-hover:text-foreground transition-colors">
                      View course
                    </span>
                  </div>

                  <PermissionGate allow={perms.canPublishContent}>
                    <div
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <PublishStatusButton
                        isPublished={c.isPublished}
                        pending={publishingId === c.id}
                        onClick={() => {
                          if (publishingId === c.id) return;
                          togglePublish(c.id, c.isPublished);
                        }}
                      />
                    </div>
                  </PermissionGate>
                </div>
              </div>
            ))}
          </div>
        )}
      </RoleDashboard>
    </AppShell>
  );
}
