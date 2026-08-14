import { useMemo } from 'react';
import { useNavigate, useNavigation, useSearchParams } from 'react-router';
import { IconFolders } from '@tabler/icons-react';
import { Card, CourseHeroCard, DetailPageScaffold, EmptyState } from '@eduai/ui';
import { ModuleCard } from '../components/courses/ModuleCard';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '../lib/course-display';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/student.course';
import { useCourseTopics } from '../hooks/useCourseTopics';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { PaginationControls } from '~/components/common/PaginationControls';
import { absoluteOrdinal, parseListUrlParams, redirectPastEnd } from '~/lib/list-params';

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const courseId = Number(params.courseId);
  if (!Number.isFinite(courseId)) {
    throw new Response('Invalid course id', { status: 400 });
  }

  // #1207: the module grid is paged from the URL. It used to unwrap one bounded
  // page and render it as if it were the whole tree, so a course with more
  // modules than the page size silently hid the tail.
  const { page } = parseListUrlParams(request);

  const [course, modulesPage] = await Promise.all([
    api.courseById(courseId) as Promise<Course>,
    api.modulesForCourse(courseId, { page }),
  ]);

  redirectPastEnd(request, {
    page,
    total: modulesPage.total,
    pageSize: modulesPage.pageSize,
  });

  return {
    course,
    modules: modulesPage.data,
    modulesTotal: modulesPage.total,
    page: modulesPage.page,
    pageSize: modulesPage.pageSize,
  };
}

export default function StudentCourseModules({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const { course, modules, modulesTotal, page, pageSize } = loaderData;
  const moduleList = useMemo(() => modules ?? [], [modules]);

  const goToPage = (nextPage: number) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(nextPage));
        return next;
      },
      { preventScrollReset: false },
    );
  };
  const accentColor = accentForCourse(course);
  const { topics, total: topicsTotal } = useCourseTopics(course?.id ?? null);

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
    <DetailPageScaffold
      padding="app"
      hero={
        <CourseHeroCard
          code={courseCode(course)}
          term={courseTerm(course)}
          year={courseYear(course)}
          name={courseName(course)}
          description={course.description}
          accentColor={accentForCourse(course)}
          // #1207: "+N more" rather than silently ending at the page bound.
          topics={[
            ...topics.map((topic) => topic.name),
            ...(topicsTotal > topics.length ? [`+${topicsTotal - topics.length} more`] : []),
          ]}
          // #1207: count the whole course, not the loaded page.
          topRightBadges={[`${modulesTotal} ${modulesTotal === 1 ? 'module' : 'modules'}`]}
        />
      }
    >
      {moduleList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <EmptyState
            icon={<IconFolders size={22} aria-hidden="true" />}
            title="No modules available"
            description="This course doesn't have any modules yet. Check back later."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {moduleList.map((module, index) => (
            <ModuleCard
              key={module.id}
              // Absolute ordinal so numbering continues across pages.
              index={absoluteOrdinal(page, pageSize, index)}
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

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={modulesTotal}
        onPageChange={goToPage}
        disabled={navigation.state === 'loading'}
      />
    </DetailPageScaffold>
  );
}
