import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { PageHeading } from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course } from '../lib/types';
import type { Route } from './+types/student';
import { AtRoleBanner } from '../components/rbac/AtRoleBanner';
import { useLocalUser } from '../hooks/useLocalUser';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
import { DashboardStatGrid } from '~/components/dashboard/DashboardStatGrid';
import { buildStudentDashboardStats } from '~/lib/dashboard-stats';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

export default function StudentHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { user } = useLocalUser();
  const courseList = useMemo(() => loaderData.courses ?? [], [loaderData.courses]);
  const stats = useMemo(() => buildStudentDashboardStats(courseList), [courseList]);

  return (
    <AppShell breadcrumbs={<ShellBreadcrumbs items={[{ label: 'My courses' }]} />}>
      <div className="space-y-6">
        {user ? <AtRoleBanner role={user.role} variant="student" /> : null}

        <div data-tour="student-dashboard-header">
          <PageHeading
            heading="My courses"
            subheading="Continue where you left off or explore new learning materials."
          />
        </div>

        <DashboardStatGrid stats={stats} />

        {courseList.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-lg border bg-card p-12 text-center shadow-sm">
            <h2 className="mb-2 text-xl font-bold text-foreground">No courses yet</h2>
            <p className="text-sm text-muted-foreground">
              You are not enrolled in any published courses yet. Enrollments sync automatically
              from Core when you sign in.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courseList.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => navigate(`/student/courses/${course.id}`)}
                className="group rounded-lg border bg-card p-6 text-left shadow-sm transition hover:shadow-md"
                data-tour={course.id === courseList[0]?.id ? 'student-course-card-first' : undefined}
                data-tour-route={
                  course.id === courseList[0]?.id ? `/student/courses/${course.id}` : undefined
                }
              >
                <h3 className="mb-1 line-clamp-2 text-lg font-semibold text-foreground group-hover:text-primary">
                  {course.title}
                </h3>
                {course.description ? (
                  <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{course.description}</p>
                ) : null}
                {course.progress && course.progress.total > 0 ? (
                  <div className="border-t border-border pt-4">
                    <ProgressBarFromData progress={course.progress} size="sm" showLabel />
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
