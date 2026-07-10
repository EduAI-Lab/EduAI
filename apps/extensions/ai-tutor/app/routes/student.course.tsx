import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconChevronRight, IconFolders } from '@tabler/icons-react';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  PageHeading,
} from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/student.course';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';

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

  useShellBreadcrumbs([
    { label: 'My courses', href: '/student' },
    {
      label: course?.title || 'Course',
      node: course?.id != null ? (
        <CourseSwitcher
          courseId={course.id}
          basePath="/student"
          currentTitle={course?.title || 'Course'}
        />
      ) : undefined,
    },
  ]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <PageHeading
          heading={course?.title || 'Course'}
          subheading={course?.description ?? undefined}
        />
        <Badge variant="secondary" size="sm">
          {moduleList.length} {moduleList.length === 1 ? 'module' : 'modules'}
        </Badge>
      </div>

      {moduleList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconFolders size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No modules available</h3>
              <p className="text-sm text-muted-foreground">
                This course doesn&apos;t have any modules yet. Check back later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {moduleList.map((module, index) => (
            <Card
              key={module.id}
              hoverable
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/student/module/${module.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/student/module/${module.id}`);
                }
              }}
              className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-tour={index === 0 ? 'student-module-card-first' : undefined}
              data-tour-route={index === 0 ? `/student/module/${module.id}` : undefined}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <Badge variant="secondary" size="sm">
                    Module
                  </Badge>
                </div>
                <CardTitle className="line-clamp-2 pt-1 transition-colors group-hover:text-primary">
                  {module.title}
                </CardTitle>
                {module.description ? (
                  <CardDescription className="line-clamp-2">{module.description}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                {module.progress && module.progress.total > 0 ? (
                  <ProgressBarFromData progress={module.progress} size="sm" showLabel />
                ) : (
                  <p className="text-sm text-muted-foreground">Not started yet</p>
                )}
              </CardContent>
              <CardFooter>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-text">
                  View module
                  <IconChevronRight size={15} aria-hidden="true" />
                </span>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
