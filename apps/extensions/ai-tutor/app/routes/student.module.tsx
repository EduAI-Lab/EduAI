import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconChevronRight, IconFileText } from '@tabler/icons-react';
import {
  Badge,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  PageHeading,
} from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.topic';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';

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

  useShellBreadcrumbs(breadcrumbItems);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <PageHeading heading={module?.title || 'Module'} subheading="Module lessons" />
        <Badge variant="secondary" size="sm">
          {lessonList.length} {lessonList.length === 1 ? 'lesson' : 'lessons'}
        </Badge>
      </div>

      {lessonList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconFileText size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No lessons available</h3>
              <p className="text-sm text-muted-foreground">
                This module doesn&apos;t have any lessons yet. Check back later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {lessonList.map((lesson, index) => (
            <Card
              key={lesson.id}
              hoverable
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/student/lesson/${lesson.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/student/lesson/${lesson.id}`);
                }
              }}
              className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-tour={index === 0 ? 'student-lesson-card-first' : undefined}
              data-tour-route={index === 0 ? `/student/lesson/${lesson.id}` : undefined}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <Badge variant="secondary" size="sm">
                    Lesson
                  </Badge>
                </div>
                <CardTitle className="line-clamp-2 pt-1 transition-colors group-hover:text-primary">
                  {lesson.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lesson.progress && lesson.progress.total > 0 ? (
                  <ProgressBarFromData progress={lesson.progress} size="sm" showLabel />
                ) : (
                  <p className="text-sm text-muted-foreground">Not started yet</p>
                )}
              </CardContent>
              <CardFooter>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-text">
                  View lesson
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
