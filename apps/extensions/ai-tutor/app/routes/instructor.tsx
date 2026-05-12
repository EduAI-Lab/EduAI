/**
 * @file Instructor dashboard — the entry point for everything teaching-side.
 *
 * Route: /instructor
 * Auth: PROFESSOR (the role string used for instructor accounts)
 * Loads: api.listCourses() — the backend already filters to courses this
 *        instructor has been assigned to, so no additional client filter.
 * Owns: course-card grid, EduAI import panel (browse external EduAI courses
 *       and pull them in), and the publish/unpublish toggle for each course.
 * Gotchas:
 *   - Publish toggle uses React 19's useOptimistic so the badge flips
 *     instantly; on server error the base state is restored, which causes
 *     the optimistic value to drop on the next render.
 *   - parseErrorMessage tolerates either JSON-encoded server errors
 *     (`{"error": "..."}`) or plain Error.message strings.
 *   - The EduAI import panel lazily fetches its catalog the first time it is
 *     opened (ensureEduAiCourses) to keep the initial route snappy.
 * Related: routes/instructor.course.tsx (drilldown), components/PublishStatusButton
 */
import { useOptimistic, useState } from 'react';
import { useNavigate } from 'react-router';
import Nav from '../components/Nav';
import { PublishStatusButton } from '../components/PublishStatusButton';
import api from '../lib/api';
import type { Course, EduAiCourse } from '../lib/types';
import type { Route } from './+types/instructor';
import { requireClientUser } from '~/lib/client-auth';

/**
 * Loads the instructor's course list. The backend scopes /courses to the
 * authenticated user's role, so this is the full set the instructor can act on.
 */
export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser('PROFESSOR');
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

/**
 * Instructor home. Shows owned courses, the EduAI import panel, and the
 * publish toggle for each course. Clicking a card navigates to the course
 * drilldown route.
 */
export default function InstructorHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>(loaderData.courses ?? []);
  const [loading, setLoading] = useState(false);
  const [showEduAiImport, setShowEduAiImport] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [eduAiCourses, setEduAiCourses] = useState<EduAiCourse[]>([]);
  const [loadingEduAiCourses, setLoadingEduAiCourses] = useState(false);
  const [importingExternalId, setImportingExternalId] = useState<string | null>(null);
  const [eduAiError, setEduAiError] = useState<string | null>(null);

  const [oCourses, addCourseOpt] = useOptimistic(
    courses,
    (state, patch: (items: Course[]) => Course[]) => patch(state),
  );

  // The API client throws Errors whose .message is sometimes a raw JSON
  // payload (`{"error":"..."}`) and sometimes a plain string. Try to surface
  // the structured `error` field when present; otherwise fall back to the
  // raw message. Returns a generic line for non-Error values.
  const parseErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
          return parsed.error;
        }
      } catch {
        // Ignore JSON parse failures
      }
      return error.message;
    }
    return 'Something went wrong. Please try again.';
  };

  const loadCourses = async () => {
    setLoading(true);
    try {
      const data: Course[] = await api.listCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEduAiCourses = async () => {
    setLoadingEduAiCourses(true);
    setEduAiError(null);
    try {
      const data = (await api.listEduAiCourses()) as EduAiCourse[];
      setEduAiCourses(data);
    } catch (error) {
      console.error('Failed to load EduAI courses:', error);
      setEduAiError(parseErrorMessage(error));
    } finally {
      setLoadingEduAiCourses(false);
    }
  };

  const ensureEduAiCourses = () => {
    if (eduAiCourses.length > 0 || loadingEduAiCourses) return;
    fetchEduAiCourses();
  };

  const importEduAiCourse = async (externalCourseId: string) => {
    if (!externalCourseId) return;
    setImportingExternalId(externalCourseId);
    setEduAiError(null);
    try {
      await api.importEduAiCourse({ externalCourseId });
      setEduAiCourses((prev) => prev.filter((course) => course.id !== externalCourseId));
      await loadCourses();
    } catch (error) {
      console.error('Failed to import EduAI course:', error);
      setEduAiError(parseErrorMessage(error));
    } finally {
      setImportingExternalId((current) => (current === externalCourseId ? null : current));
    }
  };

  // Optimistic publish toggle: addCourseOpt flips the badge instantly via
  // useOptimistic, then the server response confirms or the catch branch
  // restores the prior published state. Reverting the base state is what
  // causes useOptimistic to drop the now-stale optimistic value.
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

      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[1000px] h-[600px] bg-primary/3 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl translate-y-1/3 translate-x-1/4" />
        <div className="absolute inset-0 grid-lines opacity-30" />
      </div>

      <div className="container mx-auto px-6 py-10 space-y-8">
        {/* Page header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">Dashboard</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Teaching
            </h1>
          </div>
          <button
            onClick={() => {
              setShowEduAiImport((prev) => {
                const next = !prev;
                if (next) {
                  ensureEduAiCourses();
                } else {
                  setEduAiError(null);
                }
                return next;
              });
            }}
            className="btn-primary"
          >
            {showEduAiImport ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close Import
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Import from EduAI
              </>
            )}
          </button>
        </header>

        {/* EduAI Import Panel */}
        {showEduAiImport && (
          <div className="card-editorial p-6 space-y-5 animate-scale-in">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m0-3l-3-3m0 0l-3 3m3-3v11.25m6-2.25h.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-.75"
                      />
                    </svg>
                  </div>
                  <h2 className="font-display text-xl font-bold text-foreground">
                    Import from EduAI
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Select a course to add its teaching card. Modules, lessons, and activities will be
                  created manually after the import.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchEduAiCourses}
                disabled={loadingEduAiCourses}
                className="btn-ghost text-sm"
              >
                <svg
                  className={`w-4 h-4 ${loadingEduAiCourses ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                Refresh
              </button>
            </div>

            {eduAiError && (
              <div className="flex items-center gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                {eduAiError}
              </div>
            )}

            {loadingEduAiCourses ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <svg
                    className="w-8 h-8 text-muted-foreground animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <p className="text-sm text-muted-foreground">Loading EduAI courses...</p>
                </div>
              </div>
            ) : eduAiCourses.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-secondary flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z"
                    />
                  </svg>
                </div>
                <p className="text-muted-foreground text-sm">
                  No courses available from EduAI yet. Try refreshing to sync again.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {eduAiCourses.map((course, index) => {
                  const termYear = [course.term, course.year].filter(Boolean).join(' ');
                  return (
                    <div
                      key={course.id}
                      className="flex flex-col rounded-xl border-2 border-dashed border-border hover:border-primary/30 bg-card p-5 transition-colors animate-fade-up"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex-1 space-y-2">
                        {course.code && <span className="tag tag-primary">{course.code}</span>}
                        {course.name && (
                          <h3 className="font-display text-lg font-bold text-foreground">
                            {course.name}
                          </h3>
                        )}
                        {termYear && <p className="text-sm text-muted-foreground">{termYear}</p>}
                        {course.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {course.description}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => importEduAiCourse(course.id)}
                        disabled={importingExternalId === course.id}
                        className="btn-primary w-full mt-4"
                      >
                        {importingExternalId === course.id ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            Importing...
                          </>
                        ) : (
                          <>
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 4.5v15m7.5-7.5h-15"
                              />
                            </svg>
                            Import course
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Course list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <svg
                className="w-8 h-8 text-muted-foreground animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="text-sm text-muted-foreground">Loading courses...</p>
            </div>
          </div>
        ) : oCourses.length === 0 ? (
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
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold text-foreground mb-2">
                No courses yet
              </h2>
              <p className="text-muted-foreground text-sm">
                Import one from EduAI to get started with your teaching materials.
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
                {/* Header */}
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

                {/* Course info */}
                <div className="flex-1 mb-4">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-2">
                    {c.title}
                  </h3>
                  {c.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                  )}
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <svg
                      className="w-4 h-4"
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
                    <span className="group-hover:text-foreground transition-colors">
                      View course
                    </span>
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
