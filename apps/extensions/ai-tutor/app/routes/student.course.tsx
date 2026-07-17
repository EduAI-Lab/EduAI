import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconFolders } from '@tabler/icons-react';
import { Card, CardContent, CourseHeroCard } from '@eduai/ui';
import { ModuleCard } from '../components/courses/ModuleCard';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '../lib/course-display';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/student.course';
import { useCourseTopics } from '../hooks/useCourseTopics';
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
  const accentColor = accentForCourse(course);
  const { topics } = useCourseTopics(course?.id ?? null);

  useShellBreadcrumbs([
    { label: 'Courses', href: '/student' },
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
      <CourseHeroCard
        code={courseCode(course)}
        term={courseTerm(course)}
        year={courseYear(course)}
        name={courseName(course)}
        description={course.description}
        accentColor={accentForCourse(course)}
        topics={topics.map((topic) => topic.name)}
        topRightBadges={[`${moduleList.length} ${moduleList.length === 1 ? 'module' : 'modules'}`]}
      />

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
            <ModuleCard
              key={module.id}
              index={index}
              title={module.title}
              description={module.description}
              accentColor={accentColor}
              showProgress
              progress={module.progress}
              onClick={() => navigate(`/student/module/${module.id}`)}
              dataTour={index === 0 ? 'student-module-card-first' : undefined}
              dataTourRoute={index === 0 ? `/student/module/${module.id}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
