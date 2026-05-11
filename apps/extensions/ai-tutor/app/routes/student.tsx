import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import Nav from '../components/Nav';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course } from '../lib/types';
import type { Route } from './+types/student';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser('STUDENT');
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

export default function StudentHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const courseList = useMemo(() => loaderData.courses ?? [], [loaderData.courses]);

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
        {/* Page header */}
        <header className="mb-10 animate-fade-up" data-tour="student-dashboard-header">
          <div className="flex items-end justify-between gap-4 mb-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Dashboard</p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                My Courses
              </h1>
            </div>
            <div className="hidden sm:block">
              <div className="tag tag-accent">
                {courseList.length} {courseList.length === 1 ? 'Course' : 'Courses'}
              </div>
            </div>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Continue where you left off or explore new learning materials.
          </p>
        </header>

        {/* Course grid */}
        {courseList.length === 0 ? (
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
                    d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                  />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold text-foreground mb-2">
                No courses yet
              </h2>
              <p className="text-muted-foreground text-sm">
                You haven't been enrolled in any courses. Contact your instructor to get started.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {courseList.map((course, index) => (
              <button
                key={course.id}
                onClick={() => navigate(`/student/courses/${course.id}`)}
                className="group card-editorial p-6 text-left transition-all duration-300 hover:shadow-xl hover:-translate-y-1 glow animate-fade-up"
                style={{ animationDelay: `${150 + index * 50}ms` }}
                data-tour={index === 0 ? 'student-course-card-first' : undefined}
                data-tour-route={index === 0 ? `/student/courses/${course.id}` : undefined}
              >
                {/* Course icon */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <svg
                      className="w-6 h-6"
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

                  {/* Arrow indicator */}
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

                {/* Course info */}
                <div className="mb-4">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {course.title}
                  </h3>
                  {course.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {course.description}
                    </p>
                  )}
                </div>

                {/* Progress */}
                {course.progress && course.progress.total > 0 && (
                  <div className="pt-4 border-t border-border">
                    <ProgressBarFromData progress={course.progress} size="sm" showLabel />
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
