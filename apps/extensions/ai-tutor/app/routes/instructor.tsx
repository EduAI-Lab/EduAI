/**
 * @file Instructor dashboard — the entry point for everything teaching-side.
 *
 * Route: /instructor
 * Courses are mirrored from Core automatically on sign-in and when the list loads.
 */
import { useOptimistic, useState } from 'react';
import { useNavigate } from 'react-router';
import Nav from '../components/Nav';
import { PublishStatusButton } from '../components/PublishStatusButton';
import api from '../lib/api';
import type { Course } from '../lib/types';
import type { Route } from './+types/instructor';
import { requireClientUser } from '~/lib/client-auth';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

export default function InstructorHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>(loaderData.courses ?? []);
  const [publishingId, setPublishingId] = useState<number | null>(null);

  const [oCourses, addCourseOpt] = useOptimistic(
    courses,
    (state, patch: (items: Course[]) => Course[]) => patch(state),
  );

  const togglePublish = async (courseId: number, currentlyPublished: boolean) => {
    addCourseOpt((items) =>
      items.map((course) =>
        course.id === courseId ? { ...course, isPublished: !currentlyPublished } : course,
      ),
    );
    setPublishingId(courseId);

    try {
      const updated = currentlyPublished
        ? await api.unpublishCourse(courseId)
        : await api.publishCourse(courseId);
      setCourses((prev) => prev.map((course) => (course.id === courseId ? updated : course)));
    } catch (error) {
      console.error('Failed to toggle publish status', error);
      setCourses((prev) =>
        prev.map((course) =>
          course.id === courseId ? { ...course, isPublished: currentlyPublished } : course,
        ),
      );
    } finally {
      setPublishingId((current) => (current === courseId ? null : current));
    }
  };

  return (
    <div className="min-h-dvh bg-background">
      <Nav />

      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[1000px] h-[600px] bg-primary/3 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl translate-y-1/3 translate-x-1/4" />
        <div className="absolute inset-0 grid-lines opacity-30" />
      </div>

      <div className="container mx-auto px-6 py-10 space-y-8">
        <header className="animate-fade-up">
          <p className="text-sm font-medium text-muted-foreground mb-1">Dashboard</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Teaching
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            Your courses come from Core automatically — topics and enrollments stay in sync when you
            sign in or open this page.
          </p>
        </header>

        {oCourses.length === 0 ? (
          <div className="animate-fade-up delay-150">
            <div className="card-editorial p-12 text-center max-w-lg mx-auto">
              <h2 className="font-display text-xl font-bold text-foreground mb-2">
                No courses yet
              </h2>
              <p className="text-muted-foreground text-sm">
                Courses you teach in Core should appear here after sign-in. If something is missing,
                confirm you are enrolled as instructor in Core and refresh this page.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {oCourses.map((c, index) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/instructor/courses/${c.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/instructor/courses/${c.id}`);
                  }
                }}
                className="group card-editorial p-6 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 glow flex flex-col animate-fade-up focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={{ animationDelay: `${150 + index * 50}ms` }}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
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
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                  </div>

                  {c.externalSource === 'EDUAI' && <span className="tag tag-primary">EduAI</span>}
                </div>

                <div className="flex-1 mb-4">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {c.title}
                  </h3>
                  {c.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                  )}
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="group-hover:text-foreground transition-colors">View course</span>
                  </div>

                  <div
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <PublishStatusButton
                      isPublished={c.isPublished}
                      pending={publishingId === c.id}
                      onClick={() => {
                        if (publishingId === c.id) return;
                        togglePublish(c.id, c.isPublished);
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
