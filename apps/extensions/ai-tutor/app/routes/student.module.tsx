import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { IconChevronLeft, IconNotebook } from '@tabler/icons-react';
import { Badge, Card, CardContent, PageHeading } from '@eduai/ui';
import { LessonCard } from '../components/lessons/LessonCard';
import type { Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.module';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { splitTitle } from '~/lib/course-title';

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

/** Picks the action verb from the learner's progress on a lesson. */
function actionLabelFor(lesson: Lesson): string {
  const progress = lesson.progress;
  if (!progress || progress.total === 0 || progress.completed === 0) return 'Start lesson';
  if (progress.completed >= progress.total) return 'Review lesson';
  return 'Continue lesson';
}

export default function StudentModuleLessons({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { course, module, lessons } = loaderData;
  const lessonList = useMemo(() => lessons ?? [], [lessons]);

  // Aggregate progress across all lessons in the module — real, derived from
  // each lesson's own progress payload (never fabricated).
  const moduleProgress = useMemo(() => {
    const withProgress = lessonList.filter((lesson) => lesson.progress && lesson.progress.total > 0);
    if (withProgress.length === 0) return null;
    const completed = withProgress.reduce((sum, lesson) => sum + (lesson.progress?.completed ?? 0), 0);
    const total = withProgress.reduce((sum, lesson) => sum + (lesson.progress?.total ?? 0), 0);
    return { completed, total };
  }, [lessonList]);

  useShellBreadcrumbs([
    { label: 'Courses', href: '/student' },
    {
      label: course?.title || 'Course',
      node:
        course?.id != null ? (
          <CourseSwitcher courseId={course.id} basePath="/student" currentTitle={course?.title || 'Course'} />
        ) : undefined,
    },
    module?.title
      ? { label: splitTitle(module.title).label, title: module.title }
      : { label: 'Module' },
  ]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <div className="flex flex-col gap-4">
        {module?.courseOfferingId != null && (
          <Link
            to={`/student/courses/${module.courseOfferingId}`}
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconChevronLeft size={15} aria-hidden="true" />
            Back to course
          </Link>
        )}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <PageHeading heading={module?.title || 'Module'} subheading="Module lessons" />
          <Badge variant="secondary" size="sm">
            {lessonList.length} {lessonList.length === 1 ? 'lesson' : 'lessons'}
          </Badge>
        </div>
      </div>

      {(module?.description || moduleProgress) && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            {module?.description ? (
              <p className="text-sm text-muted-foreground">{module.description}</p>
            ) : (
              <span />
            )}
            {moduleProgress && (
              <div className="flex shrink-0 items-center gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Your progress</span>
                <span className="font-bold tabular-nums text-foreground">
                  {moduleProgress.total > 0
                    ? Math.round((moduleProgress.completed / moduleProgress.total) * 100)
                    : 0}
                  %
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {lessonList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconNotebook size={22} aria-hidden="true" />
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
            <LessonCard
              key={lesson.id}
              index={index + 1}
              title={lesson.title}
              progress={lesson.progress}
              isPublished={lesson.isPublished ? undefined : false}
              actionLabel={actionLabelFor(lesson)}
              onClick={() => navigate(`/student/lesson/${lesson.id}`)}
              dataTour={index === 0 ? 'student-lesson-card-first' : undefined}
              dataTourRoute={index === 0 ? `/student/lesson/${lesson.id}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
