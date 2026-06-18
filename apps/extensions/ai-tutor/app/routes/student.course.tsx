import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { PageHeading } from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/student.course';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const courseId = Number(params.courseId);
  if (!Number.isFinite(courseId)) {
    throw new Response('Invalid course id', { status: 400 });
  }

  const [course, modules] = await Promise.all([
    api.courseById(courseId) as Promise<Course>,
    api.modulesForCourse(courseId) as Promise<Module[]>,
  ]);

  return { course, modules };
}

export default function StudentCourseModules({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { course, modules } = loaderData;
  const moduleList = useMemo(() => modules ?? [], [modules]);

  return (
    <AppShell
      breadcrumbs={
        <ShellBreadcrumbs
          items={[
            { label: 'My courses', href: '/student' },
            { label: course?.title || 'Course' },
          ]}
        />
      }
    >
      <div className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeading
            heading={course?.title || 'Course'}
            subheading={course?.description ?? undefined}
          />
          <span className="tag">
            {moduleList.length} {moduleList.length === 1 ? 'Module' : 'Modules'}
          </span>
        </div>

        {moduleList.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-lg border bg-card p-12 text-center shadow-sm">
            <h2 className="mb-2 text-xl font-bold text-foreground">No modules available</h2>
            <p className="text-sm text-muted-foreground">
              This course doesn&apos;t have any modules yet. Check back later!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {moduleList.map((module, index) => (
              <button
                key={module.id}
                type="button"
                onClick={() => navigate(`/student/module/${module.id}`)}
                className="group rounded-lg border bg-card p-6 text-left shadow-sm transition hover:shadow-md"
                data-tour={index === 0 ? 'student-module-card-first' : undefined}
                data-tour-route={index === 0 ? `/student/module/${module.id}` : undefined}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-sm font-bold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="tag tag-accent">Module</div>
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="mb-1 line-clamp-2 text-lg font-semibold text-foreground group-hover:text-primary">
                    {module.title}
                  </h3>
                  {module.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{module.description}</p>
                  ) : null}
                </div>

                {module.progress && module.progress.total > 0 ? (
                  <div className="border-t border-border pt-4">
                    <ProgressBarFromData progress={module.progress} size="sm" showLabel />
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
