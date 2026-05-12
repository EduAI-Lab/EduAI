import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import Nav from '../components/Nav';
import { ProgressBarFromData } from '../components/ProgressBar';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import type { Course, Lesson, ModuleDetail } from '../lib/types';
import type { Route } from './+types/student.topic';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser('STUDENT');
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

  return (
    <div className="min-h-dvh bg-background">
      <Nav />

      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
        <div className="absolute inset-0 dots-pattern opacity-50" />
      </div>

      <div className="container mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <Breadcrumb className="mb-6 animate-fade-in">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to="/student"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  My Courses
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-border">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              {course && module ? (
                <BreadcrumbLink asChild>
                  <Link
                    to={`/student/courses/${module.courseOfferingId}`}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {course.title}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Course</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-border">/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium text-foreground">
                {module?.title || 'Module'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Page header */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-start gap-4 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-accent/50 flex items-center justify-center text-accent-foreground flex-shrink-0">
              <svg
                className="w-7 h-7"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Module</p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {module?.title || 'Module'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="tag">
              {lessonList.length} {lessonList.length === 1 ? 'Lesson' : 'Lessons'}
            </span>
          </div>
        </header>

        {/* Lesson grid */}
        {lessonList.length === 0 ? (
          <div className="animate-fade-up delay-150">
            <div className="card-editorial p-12 text-center max-w-lg mx-auto">
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
                    d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
                  />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold text-foreground mb-2">
                No lessons available
              </h2>
              <p className="text-muted-foreground text-sm">
                This module doesn't have any lessons yet. Check back later!
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {lessonList.map((lesson, index) => (
              <button
                key={lesson.id}
                onClick={() => navigate(`/student/lesson/${lesson.id}`)}
                className="group card-editorial p-6 text-left transition-all duration-300 hover:shadow-xl hover:-translate-y-1 glow animate-fade-up"
                style={{ animationDelay: `${150 + index * 50}ms` }}
                data-tour={index === 0 ? 'student-lesson-card-first' : undefined}
                data-tour-route={index === 0 ? `/student/lesson/${lesson.id}` : undefined}
              >
                {/* Lesson number badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="tag">Lesson</div>
                  </div>

                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0">
                    <svg
                      className="w-4 h-4 text-foreground"
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
                  </div>
                </div>

                {/* Lesson info */}
                <div className="mb-4">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {lesson.title}
                  </h3>
                </div>

                {/* Progress */}
                {lesson.progress && lesson.progress.total > 0 && (
                  <div className="pt-4 border-t border-border">
                    <ProgressBarFromData progress={lesson.progress} size="sm" showLabel />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
