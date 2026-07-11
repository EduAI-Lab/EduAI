import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconNotebook } from '@tabler/icons-react';
import { Card, CardContent } from '@eduai/ui';
import { LessonCard } from '../components/lessons/LessonCard';
import { ModuleHero } from '../components/lessons/ModuleHero';
import { accentForCourse } from '../lib/course-display';
import type { Course, Lesson, Module, ModuleDetail } from '../lib/types';
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

  // Course + ordered module list in parallel — the sibling list gives the
  // module's true 1-based ordinal for the hero watermark (see instructor.module).
  let course: Course | null = null;
  let moduleOrder = 0;
  if (module.courseOfferingId) {
    const [courseData, siblingModules] = await Promise.all([
      api.courseById(module.courseOfferingId) as Promise<Course>,
      api.modulesForCourse(module.courseOfferingId) as Promise<Module[]>,
    ]);
    course = courseData;
    moduleOrder = siblingModules.findIndex((m) => m.id === module.id) + 1;
  }

  return { course, module, lessons, moduleOrder };
}

export default function StudentModuleLessons({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { course, module, lessons, moduleOrder } = loaderData;
  const accentColor = course ? accentForCourse(course) : undefined;
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

  const heroStats = [
    {
      label: lessonList.length === 1 ? 'Lesson' : 'Lessons',
      value: lessonList.length,
      accent: true,
    },
    ...(moduleProgress
      ? [{ label: 'Activities', value: moduleProgress.total }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6">
      <ModuleHero
        order={moduleOrder > 0 ? moduleOrder : undefined}
        title={module?.title || 'Module'}
        description={module?.description}
        accentColor={accentColor}
        stats={heroStats}
        progress={moduleProgress}
      />

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
              orderText={moduleOrder > 0 ? `${moduleOrder}.${index + 1}` : undefined}
              title={lesson.title}
              content={lesson.contentMd}
              accentColor={accentColor}
              progress={lesson.progress}
              isPublished={lesson.isPublished ? undefined : false}
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
