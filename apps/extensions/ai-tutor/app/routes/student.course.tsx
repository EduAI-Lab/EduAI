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
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/student.course';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser('STUDENT');
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
              <BreadcrumbPage className="font-medium text-foreground">
                {course?.title || 'Course'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Page header */}
        <header className="mb-10 animate-fade-up">
          <div className="flex items-start gap-4 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
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
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {course?.title || 'Course'}
              </h1>
              {course?.description && (
                <p className="text-muted-foreground mt-1 max-w-2xl">{course.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="tag">
              {moduleList.length} {moduleList.length === 1 ? 'Module' : 'Modules'}
            </span>
          </div>
        </header>

        {/* Module grid */}
        {moduleList.length === 0 ? (
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
                    d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z"
                  />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold text-foreground mb-2">
                No modules available
              </h2>
              <p className="text-muted-foreground text-sm">
                This course doesn't have any modules yet. Check back later!
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {moduleList.map((module, index) => (
              <button
                key={module.id}
                onClick={() => navigate(`/student/module/${module.id}`)}
                className="group card-editorial p-6 text-left transition-all duration-300 hover:shadow-xl hover:-translate-y-1 glow animate-fade-up"
                style={{ animationDelay: `${150 + index * 50}ms` }}
                data-tour={index === 0 ? 'student-module-card-first' : undefined}
                data-tour-route={index === 0 ? `/student/module/${module.id}` : undefined}
              >
                {/* Module number badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="tag tag-accent">Module</div>
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

                {/* Module info */}
                <div className="mb-4">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {module.title}
                  </h3>
                  {module.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {module.description}
                    </p>
                  )}
                </div>

                {/* Progress */}
                {module.progress && module.progress.total > 0 && (
                  <div className="pt-4 border-t border-border">
                    <ProgressBarFromData progress={module.progress} size="sm" showLabel />
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
