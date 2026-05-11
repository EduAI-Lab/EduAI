/**
 * @file Instructor module view — the lesson list inside a single module.
 *
 * Route: /instructor/module/:moduleId
 * Auth: PROFESSOR
 * Loads: module detail, its lessons (parallel), then its course (sequential
 *        because the courseId comes from the module row).
 * Owns: lesson CRUD entry points, cross-course lesson import (course →
 *       module → lesson selection), and per-lesson publish toggle.
 * Gotchas:
 *   - File name is misleading: this lives at `instructor.topic.tsx` but the
 *     route path is `/instructor/module/:moduleId` (legacy naming from when
 *     "module" was called "topic"). See app/routes.ts for the actual mapping.
 *   - Publish cascade goes one level deeper than instructor.course.tsx: a
 *     lesson can publish only if BOTH the parent course and parent module
 *     are published. The tooltip names whichever ancestor is blocking.
 *   - Two request-id refs (sourceModulesRequestIdRef and
 *     sourceLessonsRequestIdRef) guard each leg of the import drill-down
 *     against out-of-order responses.
 * Related: routes/instructor.course.tsx (parent), routes/instructor.list.tsx (child)
 */
import type { FormEvent } from 'react';
import { useOptimistic, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import Nav from '../components/Nav';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import { PublishStatusButton } from '../components/PublishStatusButton';
import api from '../lib/api';
import type { Course, Lesson, Module, ModuleDetail } from '../lib/types';
import type { Route } from './+types/instructor.topic';
import { requireClientUser } from '~/lib/client-auth';

/**
 * Loads the module + its lessons in parallel; then fetches the parent course
 * (sequential because its id lives on the module). The course header is
 * needed for breadcrumbs and to compute the publish-cascade gate.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser('PROFESSOR');
  const moduleId = Number(params.moduleId);
  if (!Number.isFinite(moduleId)) {
    throw new Response('Invalid module id', { status: 400 });
  }

  const [module, lessons] = await Promise.all([
    api.moduleById(moduleId) as Promise<ModuleDetail>,
    api.lessonsForModule(moduleId) as Promise<Lesson[]>,
  ]);

  const course = (await api.courseById(module.courseOfferingId)) as Course;

  return { course, module, lessons };
}

/**
 * Lesson list for one module. Hosts lesson creation, cross-course lesson
 * import (course → module → lesson selection), and the publish toggle gated
 * on both the course and module being published.
 */
export default function InstructorModuleLessons({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { moduleId } = useParams();
  const numericModuleId = moduleId ? Number(moduleId) : null;
  const { course, module, lessons: initialLessons } = loaderData;
  const [lessons, setLessons] = useState<Lesson[]>(initialLessons);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [selectedSourceCourseId, setSelectedSourceCourseId] = useState<number | null>(null);
  const [sourceModules, setSourceModules] = useState<Module[]>([]);
  const [selectedSourceModuleId, setSelectedSourceModuleId] = useState<number | null>(null);
  const [sourceLessons, setSourceLessons] = useState<Lesson[]>([]);
  const [loadingSourceCourses, setLoadingSourceCourses] = useState(false);
  const [loadingSourceModules, setLoadingSourceModules] = useState(false);
  const [loadingSourceLessons, setLoadingSourceLessons] = useState(false);
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const sourceModulesRequestIdRef = useRef(0);
  const sourceLessonsRequestIdRef = useRef(0);

  const [oLessons, addLessonOpt] = useOptimistic(
    lessons,
    (state, patch: (items: Lesson[]) => Lesson[]) => patch(state),
  );

  // React 19 derived-state-during-render pattern: when the loader returns a
  // new lessons array, sync the local mutable copy without triggering an
  // effect (which would render once with stale data first).
  const [prevInitialLessons, setPrevInitialLessons] = useState(initialLessons);
  if (initialLessons !== prevInitialLessons) {
    setPrevInitialLessons(initialLessons);
    setLessons(initialLessons);
  }

  const refreshLessons = async () => {
    if (!numericModuleId) return;
    try {
      const lessonData = await api.lessonsForModule(numericModuleId);
      setLessons(lessonData);
    } catch (error) {
      console.error('Failed to refresh lessons', error);
    }
  };

  const ensureSourceCoursesLoaded = () => {
    if (availableCourses.length > 0) return;
    setLoadingSourceCourses(true);
    api
      .listCourses()
      .then((data: Course[]) => {
        const nextCourses = module?.courseOfferingId
          ? data.filter((course: Course) => course.id !== module.courseOfferingId)
          : data;
        setAvailableCourses(nextCourses);
      })
      .catch((error) => console.error('Failed to load courses', error))
      .finally(() => setLoadingSourceCourses(false));
  };

  // Course selection invalidates both downstream legs (modules and lessons).
  // Bump both request-id refs so any in-flight responses for the previous
  // course or its modules are discarded when they resolve.
  const handleSourceCourseSelection = async (nextCourseId: number | null) => {
    const courseRequestId = ++sourceModulesRequestIdRef.current;
    ++sourceLessonsRequestIdRef.current;

    setSelectedSourceCourseId(nextCourseId);
    setSourceModules([]);
    setSelectedSourceModuleId(null);
    setSourceLessons([]);
    setSelectedLessonIds(new Set());

    if (nextCourseId == null) {
      setLoadingSourceModules(false);
      setLoadingSourceLessons(false);
      return;
    }

    setLoadingSourceModules(true);
    try {
      const modulesData = await api.modulesForCourse(nextCourseId);
      if (sourceModulesRequestIdRef.current === courseRequestId) {
        setSourceModules(modulesData);
      }
    } catch (error) {
      if (sourceModulesRequestIdRef.current === courseRequestId) {
        console.error('Failed to load modules for course', error);
        setSourceModules([]);
      }
    } finally {
      if (sourceModulesRequestIdRef.current === courseRequestId) {
        setLoadingSourceModules(false);
      }
    }
  };

  const handleSourceModuleSelection = async (nextModuleId: number | null) => {
    const lessonRequestId = ++sourceLessonsRequestIdRef.current;

    setSelectedSourceModuleId(nextModuleId);
    setSourceLessons([]);
    setSelectedLessonIds(new Set());

    if (nextModuleId == null) {
      setLoadingSourceLessons(false);
      return;
    }

    setLoadingSourceLessons(true);
    try {
      const lessonData = await api.lessonsForModule(nextModuleId);
      if (sourceLessonsRequestIdRef.current === lessonRequestId) {
        setSourceLessons(lessonData);
      }
    } catch (error) {
      if (sourceLessonsRequestIdRef.current === lessonRequestId) {
        console.error('Failed to load lessons for module', error);
        setSourceLessons([]);
      }
    } finally {
      if (sourceLessonsRequestIdRef.current === lessonRequestId) {
        setLoadingSourceLessons(false);
      }
    }
  };

  const onCreateLesson = async (event: FormEvent) => {
    event.preventDefault();
    if (!numericModuleId || !title.trim()) return;
    setCreating(true);
    try {
      await api.createLesson(numericModuleId, { title: title.trim() });
      setTitle('');
      refreshLessons();
    } catch (error) {
      console.error('Failed to create lesson', error);
    } finally {
      setCreating(false);
    }
  };

  const toggleLesson = (lessonId: number) => {
    setSelectedLessonIds((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  const onImportLessons = async () => {
    if (
      !module ||
      !numericModuleId ||
      selectedSourceModuleId == null ||
      selectedLessonIds.size === 0
    )
      return;
    setImporting(true);
    try {
      await api.importIntoCourse(module.courseOfferingId, {
        lessonIds: Array.from(selectedLessonIds),
        targetModuleId: numericModuleId,
      });
      setShowImport(false);
      await handleSourceCourseSelection(null);
      refreshLessons();
    } catch (error) {
      console.error('Import lessons failed', error);
    } finally {
      setImporting(false);
    }
  };

  const togglePublish = async (lessonId: number, currentlyPublished: boolean) => {
    // Optimistic update via useOptimistic
    addLessonOpt((items) =>
      items.map((l) => (l.id === lessonId ? { ...l, isPublished: !currentlyPublished } : l)),
    );
    setPublishingId(lessonId);

    try {
      const updated = currentlyPublished
        ? await api.unpublishLesson(lessonId)
        : await api.publishLesson(lessonId);
      // Confirm with server response
      setLessons((prev) => prev.map((l) => (l.id === lessonId ? updated : l)));
    } catch (error) {
      console.error('Failed to toggle publish status', error);
      // Rollback on error to clear optimistic change
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, isPublished: currentlyPublished } : l)),
      );
    } finally {
      setPublishingId((current) => (current === lessonId ? null : current));
    }
  };

  return (
    <div className="min-h-dvh bg-background">
      <Nav />
      <div className="container mx-auto px-4 py-8 space-y-6">
        <Breadcrumb className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/instructor">Teaching</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <BreadcrumbItem>
              {course && module ? (
                <BreadcrumbLink asChild>
                  <Link to={`/instructor/courses/${module.courseOfferingId}`}>{course.title}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>Course</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{module?.title || 'Module'}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Lessons</h2>
          </div>
          <button
            onClick={() => {
              if (!showImport) {
                ensureSourceCoursesLoaded();
              } else {
                void handleSourceCourseSelection(null);
              }
              setShowImport((prev) => !prev);
            }}
            className="btn-secondary"
          >
            {showImport ? 'Close' : 'Import Lessons'}
          </button>
        </div>

        {showImport && (
          <div className="card-editorial p-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1 text-foreground">
                Choose course
              </label>
              <select
                value={selectedSourceCourseId ?? ''}
                onChange={(e) => {
                  const nextValue = e.target.value ? Number(e.target.value) : null;
                  void handleSourceCourseSelection(nextValue);
                }}
                className="input-field"
              >
                <option value="">Select course…</option>
                {availableCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
              {loadingSourceCourses && (
                <p className="mt-2 text-xs text-muted-foreground">Loading courses…</p>
              )}
              {!loadingSourceCourses && availableCourses.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  You don't have another course to copy from yet.
                </p>
              )}
            </div>

            {selectedSourceCourseId != null && (
              <div>
                <label className="block text-sm font-semibold mb-1 text-foreground">
                  Choose module
                </label>
                <select
                  value={selectedSourceModuleId ?? ''}
                  onChange={(e) => {
                    const nextValue = e.target.value ? Number(e.target.value) : null;
                    void handleSourceModuleSelection(nextValue);
                  }}
                  className="input-field"
                >
                  <option value="">Select module…</option>
                  {sourceModules.map((sourceModule) => (
                    <option key={sourceModule.id} value={sourceModule.id}>
                      {sourceModule.title}
                    </option>
                  ))}
                </select>
                {loadingSourceModules && (
                  <p className="mt-2 text-xs text-muted-foreground">Loading modules…</p>
                )}
                {!loadingSourceModules && sourceModules.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected course has no modules yet.
                  </p>
                )}
              </div>
            )}

            {selectedSourceCourseId == null ? (
              <p className="text-sm text-muted-foreground">Select a course to begin.</p>
            ) : selectedSourceModuleId == null ? (
              <p className="text-sm text-muted-foreground">Select a module to preview lessons.</p>
            ) : loadingSourceLessons ? (
              <p className="text-sm text-muted-foreground">Loading lessons…</p>
            ) : sourceLessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">Selected module has no lessons yet.</p>
            ) : (
              <div className="space-y-3">
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 text-sm font-semibold bg-secondary text-secondary-foreground">
                    Lessons
                  </div>
                  <div className="p-3 space-y-2 bg-card">
                    {sourceLessons.map((lesson) => (
                      <label
                        key={lesson.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                          selectedLessonIds.has(lesson.id)
                            ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedLessonIds.has(lesson.id)}
                          onChange={() => toggleLesson(lesson.id)}
                        />
                        <span className="text-sm text-foreground">{lesson.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  onClick={onImportLessons}
                  disabled={importing || selectedLessonIds.size === 0}
                  className="btn-primary"
                >
                  {importing ? 'Importing…' : 'Import selected lessons'}
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={onCreateLesson} className="flex gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New lesson title…"
            className="input-field flex-1"
          />
          <button disabled={creating || !title.trim()} className="btn-primary">
            {creating ? 'Adding…' : 'Add Lesson'}
          </button>
        </form>

        {oLessons.length === 0 ? (
          <div className="text-muted-foreground">No lessons yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {oLessons.map((lesson, idx) => {
              const canPublish = course?.isPublished && module?.isPublished;
              const blocked = !lesson.isPublished && !canPublish;
              const parentName = !course?.isPublished
                ? course?.title || 'the parent course'
                : !module?.isPublished
                  ? module?.title || 'the parent module'
                  : null;
              const tooltipMessage =
                blocked && parentName
                  ? `${parentName} is unpublished, so you can't publish ${lesson.title}.`
                  : null;
              const busy = publishingId === lesson.id;
              return (
                <div
                  key={lesson.id}
                  className="card-editorial p-5 hover:shadow-lg transition group cursor-pointer flex flex-col h-full animate-fade-up"
                  style={{ animationDelay: `${idx * 50}ms` }}
                  onClick={() => navigate(`/instructor/lesson/${lesson.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/instructor/lesson/${lesson.id}`);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-display font-semibold text-sm">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground group-hover:text-primary transition-colors">
                        {lesson.title}
                      </div>
                    </div>
                  </div>
                  <div className="flex-grow"></div>
                  <div className="mt-4 flex justify-end">
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <PublishStatusButton
                        isPublished={lesson.isPublished}
                        pending={busy}
                        blockedReason={tooltipMessage}
                        onClick={() => {
                          if (busy || blocked) return;
                          togglePublish(lesson.id, lesson.isPublished);
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
