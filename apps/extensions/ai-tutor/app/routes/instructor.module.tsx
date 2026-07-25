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
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { IconNotebook, IconPlus, IconUpload } from '@tabler/icons-react';
import {
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DetailPageScaffold,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableProvider,
  SortableItem,
  DragHandle,
  Textarea,
} from '@eduai/ui';
import { LessonCard } from '../components/lessons/LessonCard';
import { ModuleHero } from '../components/lessons/ModuleHero';
import { PublishMenu } from '../components/PublishMenu';
import { accentForCourse } from '../lib/course-display';
import api from '../lib/api';
import type { Course, Lesson, Module, ModuleDetail } from '../lib/types';
import type { Route } from './+types/instructor.module';
import { PermissionGate } from '@eduai/ui';
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

  // Fetch the course + its ordered module list in parallel. The sibling list
  // gives the module's true 1-based ordinal (matching the course-view chip),
  // which the raw `position` field can't — it's 1-based from the seed but
  // 0-based via UI create.
  const [course, siblingModules] = await Promise.all([
    api.courseById(module.courseOfferingId) as Promise<Course>,
    api.modulesForCourse(module.courseOfferingId) as Promise<Module[]>,
  ]);
  const moduleOrder = siblingModules.findIndex((m) => m.id === module.id) + 1;

  return { course, module, lessons, moduleOrder };
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
  const { course, module, lessons: initialLessons, moduleOrder } = loaderData;
  const accentColor = course ? accentForCourse(course) : undefined;
  const [lessons, setLessons] = useState<Lesson[]>(initialLessons);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
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
  const [pendingPublish, setPendingPublish] = useState<{
    id: number;
    isPublished: boolean;
    title: string;
  } | null>(null);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingLesson, setDeletingLesson] = useState<Lesson | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reorderingLessons, setReorderingLessons] = useState(false);
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
      await api.createLesson(numericModuleId, {
        title: title.trim(),
        ...(content.trim() ? { contentMd: content.trim() } : {}),
      });
      setTitle('');
      setContent('');
      setCreateOpen(false);
      await refreshLessons();
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

  // Persist a drag-reordered lesson list: reorder the local list to match the
  // dropped order optimistically, then confirm with the bulk reorder endpoint;
  // a failure rolls back to the prior order.
  const reorderLessonsList = async (orderedIds: number[]) => {
    if (!numericModuleId) return;
    const current = lessons;
    const byId = new Map(current.map((l) => [l.id, l]));
    const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Lesson[];
    if (next.length !== current.length) {
      // Dropped order came from a stale render (list changed mid-drag);
      // refetch rather than persisting a partial order.
      toast.error('The lesson list changed while reordering. Refreshing — please try again.');
      await refreshLessons();
      return;
    }

    setLessons(next);
    setReorderingLessons(true);
    try {
      const updated = await api.reorderLessons(numericModuleId, orderedIds);
      setLessons(updated);
    } catch (error) {
      console.error('Failed to reorder lessons', error);
      toast.error('Failed to reorder lessons. The previous order was restored.');
      setLessons(current);
    } finally {
      setReorderingLessons(false);
    }
  };

  const openEditLesson = (lesson: Lesson) => {
    setEditingLesson(lesson);
    setEditTitle(lesson.title);
    setEditContent(lesson.contentMd ?? '');
  };

  const onSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingLesson || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await api.updateLesson(editingLesson.id, {
        title: editTitle.trim(),
        contentMd: editContent.trim() || null,
      });
      setEditingLesson(null);
      await refreshLessons();
    } catch (error) {
      console.error('Failed to update lesson', error);
    } finally {
      setSavingEdit(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deletingLesson) return;
    setDeleting(true);
    try {
      await api.deleteLesson(deletingLesson.id);
      setDeletingLesson(null);
      await refreshLessons();
    } catch (error) {
      console.error('Failed to delete lesson', error);
    } finally {
      setDeleting(false);
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

  const publishedCount = oLessons.filter((lesson) => lesson.isPublished).length;
  const heroStats = [
    { label: oLessons.length === 1 ? 'Lesson' : 'Lessons', value: oLessons.length, accent: true },
    { label: 'Published', value: publishedCount },
    { label: 'Drafts', value: oLessons.length - publishedCount },
  ];

  return (
    <DetailPageScaffold
      padding="app"
      hero={
        <ModuleHero
          order={moduleOrder > 0 ? moduleOrder : undefined}
          title={module?.title || 'Module'}
          description={module?.description}
          accentColor={accentColor}
          isPublished={module?.isPublished}
          stats={heroStats}
          actions={
            <PermissionGate allow={perms.canManageContent}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
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
              <Button
                type="button"
                size="sm"
                className="bg-white font-semibold text-[var(--course-accent)] hover:bg-white/90 hover:text-[var(--course-accent)]"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus size={15} aria-hidden="true" />
                Add lesson
              </Button>
            </PermissionGate>
          }
        />
      }
    >
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
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            if (creating) return;
            setCreateOpen(open);
            if (!open) {
              setTitle('');
              setContent('');
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add lesson</DialogTitle>
              <DialogDescription>
                Create a new lesson in {module?.title || 'this module'}. It starts as a draft — you
                can add activities and publish it afterwards.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onCreateLesson} className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="new-lesson-title">Lesson title</Label>
                <Input
                  id="new-lesson-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Introduction"
                  autoFocus
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-lesson-content">
                  Content{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="new-lesson-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Overview, reading, or notes shown at the top of the lesson (Markdown supported)…"
                  rows={5}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreateOpen(false);
                    setTitle('');
                    setContent('');
                  }}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creating || !title.trim()}>
                  {creating ? 'Adding…' : 'Add lesson'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PermissionGate>

      <PermissionGate allow={perms.canManageContent}>
        <Dialog
          open={editingLesson !== null}
          onOpenChange={(open) => {
            if (!savingEdit && !open) setEditingLesson(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit lesson</DialogTitle>
              <DialogDescription>Update this lesson&apos;s title and content.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSaveEdit} className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-lesson-title">Lesson title</Label>
                <Input
                  id="edit-lesson-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. Introduction"
                  autoFocus
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-lesson-content">
                  Content{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="edit-lesson-content"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Overview, reading, or notes shown at the top of the lesson (Markdown supported)…"
                  rows={5}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingLesson(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={savingEdit || !editTitle.trim()}>
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PermissionGate>

      <PermissionGate allow={perms.canManageContent}>
        <Dialog
          open={deletingLesson !== null}
          onOpenChange={(open) => {
            if (!deleting && !open) setDeletingLesson(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete lesson</DialogTitle>
              <DialogDescription>
                Delete <span className="font-semibold text-foreground">{deletingLesson?.title}</span>?
                This removes its activities and can't be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeletingLesson(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete lesson'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PermissionGate>

      {oLessons.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconNotebook size={22} aria-hidden="true" />}
            title="No lessons yet"
            description="Add a lesson, or import one from another course to get started."
          />
        </Card>
      ) : (
        <SortableProvider
          ids={oLessons.map((l) => l.id)}
          onReorder={reorderLessonsList}
          strategy="grid"
          disabled={!perms.canManageContent || oLessons.length < 2 || reorderingLessons}
        >
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
            const canReorder = perms.canManageContent && oLessons.length > 1;
            return (
              <SortableItem key={lesson.id} id={lesson.id} disabled={!canReorder}>
                {({ handleProps }) => (
                    <LessonCard
                      index={idx + 1}
                      orderText={moduleOrder > 0 ? `${moduleOrder}.${idx + 1}` : undefined}
                      title={lesson.title}
                      content={lesson.contentMd}
                      accentColor={accentColor}
                      onClick={() => navigate(`/instructor/lesson/${lesson.id}`)}
                      isPublished={lesson.isPublished}
                      leading={
                        canReorder ? (
                          <DragHandle handleProps={handleProps} label={`Drag to reorder ${lesson.title}`} />
                        ) : undefined
                      }
                      menuSlot={
                        perms.canPublishContent || perms.canManageContent ? (
                          <PublishMenu
                            isPublished={lesson.isPublished}
                            pending={busy}
                            blockedReason={tooltipMessage}
                            itemLabel="lesson"
                            onToggle={
                              perms.canPublishContent
                                ? () => {
                                    if (busy || blocked) return;
                                    setPendingPublish({
                                      id: lesson.id,
                                      isPublished: lesson.isPublished,
                                      title: lesson.title,
                                    });
                                  }
                                : undefined
                            }
                            onEdit={perms.canManageContent ? () => openEditLesson(lesson) : undefined}
                            onDelete={perms.canManageContent ? () => setDeletingLesson(lesson) : undefined}
                          />
                        ) : undefined
                      }
                    />
                )}
              </SortableItem>
            );
          })}
          <PermissionGate allow={perms.canManageContent}>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="group flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-primary/10">
                <IconPlus size={18} aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold">Add lesson</span>
            </button>
          </PermissionGate>
        </div>
        </SortableProvider>
      )}
      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPublish(null);
        }}
        title={
          pendingPublish
            ? pendingPublish.isPublished
              ? `Unpublish "${pendingPublish.title}"?`
              : `Publish "${pendingPublish.title}"?`
            : ''
        }
        description={
          pendingPublish
            ? pendingPublish.isPublished
              ? 'Students will lose access to this content.'
              : 'Students will be able to see this content.'
            : ''
        }
        confirmLabel={pendingPublish?.isPublished ? 'Unpublish' : 'Publish'}
        variant={pendingPublish?.isPublished ? 'destructive' : 'default'}
        onConfirm={() => {
          if (!pendingPublish) return;
          void togglePublish(pendingPublish.id, pendingPublish.isPublished);
          setPendingPublish(null);
        }}
      />
    </DetailPageScaffold>
  );
}
