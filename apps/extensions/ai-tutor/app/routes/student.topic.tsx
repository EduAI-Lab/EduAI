import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { PageHeading } from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.topic';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const moduleId = Number(params.moduleId);
  if (!Number.isFinite(moduleId)) {
    throw new Response('Invalid module id', { status: 400 });
  }

  const [module, lessons] = await Promise.all([
    api.moduleById(moduleId) as Promise<ModuleDetail>,
    api.lessonsForModule(moduleId) as Promise<Lesson[]>,
  ]);

  let course: Course | null = null;
  if (module.courseOfferingId) {
    course = (await api.courseById(module.courseOfferingId)) as Course;
  }

  return { course, module, lessons };
}

export default function StudentModuleLessons({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { course, module, lessons } = loaderData;
  const lessonList = useMemo(() => lessons ?? [], [lessons]);

  const breadcrumbItems = [
    { label: 'My courses', href: '/student' },
    ...(course && module
      ? [{ label: course.title, href: `/student/courses/${module.courseOfferingId}` }]
      : [{ label: 'Course' }]),
    { label: module?.title || 'Module' },
  ];

  return (
    <AppShell breadcrumbs={<ShellBreadcrumbs items={breadcrumbItems} />}>
      <div className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeading heading={module?.title || 'Module'} subheading="Module lessons" />
          <span className="tag">
            {lessonList.length} {lessonList.length === 1 ? 'Lesson' : 'Lessons'}
          </span>
        </div>

        {lessonList.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-lg border bg-card p-12 text-center shadow-sm">
            <h2 className="mb-2 text-xl font-bold text-foreground">No lessons available</h2>
            <p className="text-sm text-muted-foreground">
              This module doesn&apos;t have any lessons yet. Check back later!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lessonList.map((lesson, index) => (
              <button
                key={lesson.id}
                type="button"
                onClick={() => navigate(`/student/lesson/${lesson.id}`)}
                className="group rounded-lg border bg-card p-6 text-left shadow-sm transition hover:shadow-md"
                data-tour={index === 0 ? 'student-lesson-card-first' : undefined}
                data-tour-route={index === 0 ? `/student/lesson/${lesson.id}` : undefined}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold tabular-nums text-primary">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="tag">Lesson</div>
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="mb-1 line-clamp-2 text-lg font-semibold text-foreground group-hover:text-primary">
                    {lesson.title}
                  </h3>
                </div>

                {lesson.progress && lesson.progress.total > 0 ? (
                  <div className="border-t border-border pt-4">
                    <ProgressBarFromData progress={lesson.progress} size="sm" showLabel />
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
