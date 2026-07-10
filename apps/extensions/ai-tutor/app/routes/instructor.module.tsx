/**
 * @file Instructor module view — the lesson list inside a single module.
 *
 * Route: /instructor/module/:moduleId
 * Auth: INSTRUCTOR
 * Loads: module detail, its lessons (parallel), then its course (sequential
 *        because the courseId comes from the module row).
 * Owns: lesson CRUD entry points, cross-course lesson import (course →
 *       module → lesson selection), and per-lesson publish toggle.
 * Gotchas:
 *   - Hierarchy: Course › Module › Lesson. "Module" here is the mid level — it
 *     is NOT the activity-tagging "Course topics" taxonomy, a separate concept.
 *   - Publish cascade goes one level deeper than instructor.course.tsx: a
 *     lesson can publish only if BOTH the parent course and parent module
 *     are published. The tooltip names whichever ancestor is blocking.
 *   - Two request-id refs (sourceModulesRequestIdRef and
 *     sourceLessonsRequestIdRef) guard each leg of the import drill-down
 *     against out-of-order responses.
 * Related: routes/instructor.course.tsx (parent), routes/instructor.lesson.tsx (child)
 */
import type { FormEvent } from 'react';
import { useOptimistic, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { IconChevronLeft, IconNotebook, IconUpload } from '@tabler/icons-react';
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  PageHeading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@eduai/ui';
import { LessonCard } from '../components/lessons/LessonCard';
import { PublishStatusButton } from '../components/PublishStatusButton';
import api from '../lib/api';
import type { Course, Lesson, Module, ModuleDetail } from '../lib/types';
import type { Route } from './+types/instructor.module';
import { PermissionGate } from '../components/rbac/PermissionGate';
import { useAtPermissions } from '../hooks/useAtPermissions';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { splitTitle } from '~/lib/course-title';

/**
 * Loads the module + its lessons in parallel; then fetches the parent course
 * (sequential because its id lives on the module). The course header is
 * needed for breadcrumbs and to compute the publish-cascade gate.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
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
  const perms = useAtPermissions();
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

  useShellBreadcrumbs([
    { label: 'Courses', href: '/instructor' },
    {
      label: course?.title || 'Course',
      node:
        module?.courseOfferingId != null ? (
          <CourseSwitcher
            courseId={module.courseOfferingId}
            basePath="/instructor"
            currentTitle={course?.title || 'Course'}
          />
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
            to={`/instructor/courses/${module.courseOfferingId}`}
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconChevronLeft size={15} aria-hidden="true" />
            Back to course
          </Link>
        )}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <PageHeading heading={module?.title || 'Module'} subheading="Module lessons" />
          <PermissionGate allow={perms.canManageContent}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!showImport) {
                  ensureSourceCoursesLoaded();
                } else {
                  void handleSourceCourseSelection(null);
                }
                setShowImport((prev) => !prev);
              }}
            >
              <IconUpload size={15} aria-hidden="true" />
              {showImport ? 'Close import' : 'Import lessons'}
            </Button>
          </PermissionGate>
        </div>
      </div>

      <PermissionGate allow={perms.canManageContent}>
        {showImport && (
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-1.5">
                <Label htmlFor="import-lesson-course">Choose course</Label>
                <Select
                  value={
                    selectedSourceCourseId != null ? String(selectedSourceCourseId) : undefined
                  }
                  onValueChange={(value) => {
                    const nextValue = value ? Number(value) : null;
                    void handleSourceCourseSelection(nextValue);
                  }}
                >
                  <SelectTrigger id="import-lesson-course" className="w-full">
                    <SelectValue placeholder="Select course…" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCourses.map((course) => (
                      <SelectItem key={course.id} value={String(course.id)}>
                        {course.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {loadingSourceCourses && (
                  <p className="text-xs text-muted-foreground">Loading courses…</p>
                )}
                {!loadingSourceCourses && availableCourses.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    You don't have another course to copy from yet.
                  </p>
                )}
              </div>

              {selectedSourceCourseId != null && (
                <div className="space-y-1.5">
                  <Label htmlFor="import-lesson-module">Choose module</Label>
                  <Select
                    value={
                      selectedSourceModuleId != null ? String(selectedSourceModuleId) : undefined
                    }
                    onValueChange={(value) => {
                      const nextValue = value ? Number(value) : null;
                      void handleSourceModuleSelection(nextValue);
                    }}
                  >
                    <SelectTrigger id="import-lesson-module" className="w-full">
                      <SelectValue placeholder="Select module…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceModules.map((sourceModule) => (
                        <SelectItem key={sourceModule.id} value={String(sourceModule.id)}>
                          {sourceModule.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {loadingSourceModules && (
                    <p className="text-xs text-muted-foreground">Loading modules…</p>
                  )}
                  {!loadingSourceModules && sourceModules.length === 0 && (
                    <p className="text-xs text-muted-foreground">
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
                  <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border">
                    <div className="bg-muted px-4 py-2.5 text-sm font-semibold text-foreground">
                      Lessons
                    </div>
                    <div className="space-y-2 bg-card p-3">
                      {sourceLessons.map((lesson) => (
                        <label
                          key={lesson.id}
                          className={`flex items-center gap-3 rounded-[var(--radius-md)] border p-3 cursor-pointer transition ${
                            selectedLessonIds.has(lesson.id)
                              ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
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
                  <Button type="button" onClick={onImportLessons} disabled={importing || selectedLessonIds.size === 0}>
                    {importing ? 'Importing…' : 'Import selected lessons'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </PermissionGate>

      <PermissionGate allow={perms.canManageContent}>
        <Card>
          <CardContent className="py-5">
            <form onSubmit={onCreateLesson} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="new-lesson-title">Lesson title</Label>
                <Input
                  id="new-lesson-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="New lesson title…"
                />
              </div>
              <Button type="submit" disabled={creating || !title.trim()}>
                {creating ? 'Adding…' : 'Add lesson'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </PermissionGate>

      {oLessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconNotebook size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No lessons yet</h3>
              <p className="text-sm text-muted-foreground">
                Add a lesson above, or import one from another course to get started.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
              <LessonCard
                key={lesson.id}
                index={idx + 1}
                title={lesson.title}
                actionLabel="View lesson"
                onClick={() => navigate(`/instructor/lesson/${lesson.id}`)}
                isPublished={lesson.isPublished}
                statusSlot={
                  perms.canPublishContent ? (
                    <PublishStatusButton
                      isPublished={lesson.isPublished}
                      pending={busy}
                      blockedReason={tooltipMessage}
                      onClick={() => {
                        if (busy || blocked) return;
                        togglePublish(lesson.id, lesson.isPublished);
                      }}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
