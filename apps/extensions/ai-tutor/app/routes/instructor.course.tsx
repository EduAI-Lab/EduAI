/**
 * @file Instructor course view — the module list inside a single course.
 *
 * Route: /instructor/courses/:courseId
 * Auth: INSTRUCTOR
 * Loads: course detail and its module list, in parallel.
 * Owns: module CRUD entry points (add-module dialog), the cross-course module
 *       import dialog, and the per-module publish toggle.
 * Gotchas:
 *   - Publish cascade: a module can only be published while its parent
 *     course is published. The server enforces this; the UI reflects it via
 *     `blocked` and a tooltip explaining what to publish first. Unpublish
 *     cascades to lessons server-side — not handled here.
 *   - Optimistic publish via useOptimistic; failure rolls the base state
 *     back, which causes the optimistic patch to drop on the next render.
 *   - The import flow uses a request-id ref (modulesRequestIdRef) to ignore
 *     stale source-module fetches when the user changes the source course
 *     mid-load.
 * Related: routes/instructor.tsx (parent), routes/instructor.module.tsx (child)
 */
import type { FormEvent } from 'react';
import { useOptimistic, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { IconDownload, IconLayoutGrid, IconPlus } from '@tabler/icons-react';
import {
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  CourseHeroCard,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
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
import { PublishMenu } from '../components/PublishMenu';
import { ModuleCard } from '../components/courses/ModuleCard';
import { accentForCourse, courseCode, courseName, courseTerm, courseYear } from '../lib/course-display';
import api from '../lib/api';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/instructor.course';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '../hooks/useLocalUser';
import { useAtPermissions } from '../hooks/useAtPermissions';
import { CourseAnalyticsPanel } from '../components/courses/CourseAnalyticsPanel';
import { CourseTopicsHeroAction } from '../components/courses/CourseTopicsHeroAction';
import { CourseSubmissionsPanel } from '../components/courses/CourseSubmissionsPanel';
import { PermissionGate } from '../components/rbac/PermissionGate';
import { getCourseDetailTabs } from '~/lib/rbac/nav';
import { useCourseTopics } from '../hooks/useCourseTopics';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';

/**
 * Loads the course header and its modules in parallel. Throws a 400 Response
 * if the route param isn't numeric so the router renders the error boundary.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
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

/**
 * Module list for one course. Hosts module creation, the cross-course import
 * panel, and the publish toggle whose enablement depends on the parent
 * course's published state.
 */
export default function InstructorCourseModules({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const numericCourseId = courseId ? Number(courseId) : null;
  const { user } = useLocalUser();
  const perms = useAtPermissions();
  const tabs = getCourseDetailTabs(user ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits } : null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('content');
  const { course, modules: initialModules } = loaderData;
  const accentColor = accentForCourse(course);
  const courseTopics = useCourseTopics(numericCourseId);
  const [modules, setModules] = useState<Module[]>(initialModules);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [selectedSourceCourseId, setSelectedSourceCourseId] = useState<number | null>(null);
  const [sourceModules, setSourceModules] = useState<Module[]>([]);
  const [loadingSourceCourses, setLoadingSourceCourses] = useState(false);
  const [loadingSourceModules, setLoadingSourceModules] = useState(false);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingModule, setDeletingModule] = useState<Module | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingPublish, setPendingPublish] = useState<{
    id: number;
    isPublished: boolean;
    title: string;
  } | null>(null);
  const [reorderingModules, setReorderingModules] = useState(false);
  const modulesRequestIdRef = useRef(0);

  const [oModules, addModuleOpt] = useOptimistic(
    modules,
    (state, patch: (items: Module[]) => Module[]) => patch(state),
  );

  // React 19 derived-state-during-render pattern: when the loader replaces
  // `initialModules` (e.g. after a navigation back to this route), reset the
  // local mutable copy so the optimistic layer is rebuilt from fresh server
  // truth without an effect-driven flash.
  const [prevInitialModules, setPrevInitialModules] = useState(initialModules);
  if (initialModules !== prevInitialModules) {
    setPrevInitialModules(initialModules);
    setModules(initialModules);
  }

  const refreshModules = async () => {
    if (!numericCourseId) return;
    try {
      const modulesData = await api.modulesForCourse(numericCourseId);
      setModules(modulesData);
    } catch (error) {
      console.error('Failed to refresh modules', error);
    }
  };

  const ensureSourceCoursesLoaded = () => {
    if (availableCourses.length > 0) return;
    setLoadingSourceCourses(true);
    api
      .listCourses()
      .then((data: Course[]) => {
        const nextCourses = numericCourseId
          ? data.filter((course: Course) => course.id !== numericCourseId)
          : data;
        setAvailableCourses(nextCourses);
      })
      .catch((error) => console.error('Failed to load courses', error))
      .finally(() => setLoadingSourceCourses(false));
  };

  // Picking a different source course triggers a module fetch. The
  // request-id ref guards against an out-of-order response from a previously
  // selected course overwriting the current selection's modules.
  const handleSourceCourseSelection = async (nextCourseId: number | null) => {
    const requestId = ++modulesRequestIdRef.current;
    setSelectedSourceCourseId(nextCourseId);
    setSourceModules([]);
    setSelectedModuleIds(new Set());

    if (nextCourseId == null) {
      setLoadingSourceModules(false);
      return;
    }

    setLoadingSourceModules(true);
    try {
      const data = await api.modulesForCourse(nextCourseId);
      if (modulesRequestIdRef.current === requestId) {
        setSourceModules(data);
      }
    } catch (error) {
      if (modulesRequestIdRef.current === requestId) {
        console.error('Failed to load modules for course', error);
        setSourceModules([]);
      }
    } finally {
      if (modulesRequestIdRef.current === requestId) {
        setLoadingSourceModules(false);
      }
    }
  };

  const onCreateModule = async (event: FormEvent) => {
    event.preventDefault();
    if (!numericCourseId || !title.trim()) return;
    setCreating(true);
    try {
      await api.createModule(numericCourseId, { title: title.trim() });
      setTitle('');
      setCreateOpen(false);
      await refreshModules();
    } catch (error) {
      console.error('Failed to create module', error);
    } finally {
      setCreating(false);
    }
  };

  // The import dialog lazy-loads the copy-from course list the first time it
  // opens, and clears any in-flight source selection when it closes so a
  // reopened dialog starts clean.
  const handleImportOpenChange = (open: boolean) => {
    if (open) {
      ensureSourceCoursesLoaded();
    } else {
      void handleSourceCourseSelection(null);
    }
    setShowImport(open);
  };

  const toggleModuleSelection = (moduleId: number) => {
    setSelectedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const onImport = async () => {
    if (!numericCourseId || selectedSourceCourseId == null || selectedModuleIds.size === 0) return;
    setImporting(true);
    try {
      await api.importIntoCourse(numericCourseId, {
        sourceCourseId: selectedSourceCourseId,
        moduleIds: Array.from(selectedModuleIds),
      });
      setShowImport(false);
      await handleSourceCourseSelection(null);
      await refreshModules();
    } catch (error) {
      console.error('Import failed', error);
    } finally {
      setImporting(false);
    }
  };

  const togglePublish = async (moduleId: number, currentlyPublished: boolean) => {
    // Optimistic update via useOptimistic
    addModuleOpt((items) =>
      items.map((m) => (m.id === moduleId ? { ...m, isPublished: !currentlyPublished } : m)),
    );
    setPublishingId(moduleId);

    try {
      const updated = currentlyPublished
        ? await api.unpublishModule(moduleId)
        : await api.publishModule(moduleId);
      // Confirm with server response
      setModules((prev) => prev.map((m) => (m.id === moduleId ? updated : m)));
    } catch (error) {
      console.error('Failed to toggle publish status', error);
      // Rollback on error to clear optimistic change
      setModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, isPublished: currentlyPublished } : m)),
      );
    } finally {
      setPublishingId((current) => (current === moduleId ? null : current));
    }
  };

  // Persist a drag-reordered module list: reorder the local list to match the
  // dropped order optimistically, then confirm with the bulk reorder endpoint;
  // a failure rolls back to the prior order.
  const reorderModulesList = async (orderedIds: number[]) => {
    if (!numericCourseId) return;
    const current = modules;
    const byId = new Map(current.map((m) => [m.id, m]));
    const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Module[];
    if (next.length !== current.length) return;

    setModules(next);
    setReorderingModules(true);
    try {
      const updated = await api.reorderModules(numericCourseId, orderedIds);
      setModules(updated);
    } catch (error) {
      console.error('Failed to reorder modules', error);
      setModules(current);
    } finally {
      setReorderingModules(false);
    }
  };

  const openEditModule = (module: Module) => {
    setEditingModule(module);
    setEditTitle(module.title);
    setEditDescription(module.description ?? '');
  };

  const onSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingModule || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await api.updateModule(editingModule.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      });
      setEditingModule(null);
      await refreshModules();
    } catch (error) {
      console.error('Failed to update module', error);
    } finally {
      setSavingEdit(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!deletingModule) return;
    setDeleting(true);
    try {
      await api.deleteModule(deletingModule.id);
      setDeletingModule(null);
      await refreshModules();
    } catch (error) {
      console.error('Failed to delete module', error);
    } finally {
      setDeleting(false);
    }
  };

  useShellBreadcrumbs([
    { label: 'Courses', href: '/instructor' },
    {
      label: course?.title || 'Course',
      node:
        numericCourseId != null ? (
          <CourseSwitcher
            courseId={numericCourseId}
            basePath="/instructor"
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
        topics={courseTopics.topics.map((topic) => topic.name)}
        topRightBadges={[course.isPublished ? 'Published' : 'Draft']}
        topicsAction={<CourseTopicsHeroAction course={course} courseTopics={courseTopics} />}
      />

      <PageTabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as (typeof tabs)[number]['id'])}
      >
        <PageTabsList>
          {tabs.map((tab) => (
            <PageTabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </PageTabsTrigger>
          ))}
        </PageTabsList>

        <PageTabsContent value="content" className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Modules</h2>
            <PermissionGate allow={perms.canManageContent}>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleImportOpenChange(true)}
                >
                  <IconDownload className="size-4" aria-hidden="true" />
                  Import
                </Button>
                <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                  <IconPlus className="size-4" aria-hidden="true" />
                  Add module
                </Button>
              </div>
            </PermissionGate>
          </div>

          <PermissionGate allow={perms.canManageContent}>
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                if (!creating) setCreateOpen(open);
              }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add module</DialogTitle>
                  <DialogDescription>
                    Create a new module in {course.title}. Add lessons and activities to it once
                    it exists.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={onCreateModule} className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="new-module-title">Module title</Label>
                    <Input
                      id="new-module-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Getting started"
                      autoFocus
                      required
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateOpen(false)}
                      disabled={creating}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={creating || !title.trim()}>
                      {creating ? 'Adding…' : 'Add module'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </PermissionGate>

          <PermissionGate allow={perms.canManageContent}>
            <Dialog
              open={editingModule !== null}
              onOpenChange={(open) => {
                if (!savingEdit && !open) setEditingModule(null);
              }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit module</DialogTitle>
                  <DialogDescription>Update the module title and description.</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSaveEdit} className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-module-title">Module title</Label>
                    <Input
                      id="edit-module-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="e.g. Getting started"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-module-description">Description</Label>
                    <Textarea
                      id="edit-module-description"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Optional — what this module covers"
                      rows={3}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditingModule(null)}
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
              open={deletingModule !== null}
              onOpenChange={(open) => {
                if (!deleting && !open) setDeletingModule(null);
              }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Delete module</DialogTitle>
                  <DialogDescription>
                    Delete <span className="font-semibold text-foreground">{deletingModule?.title}</span>?
                    This removes its lessons and activities and can't be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDeletingModule(null)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Delete module'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </PermissionGate>

          <PermissionGate allow={perms.canManageContent}>
            <Dialog open={showImport} onOpenChange={handleImportOpenChange}>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Import modules</DialogTitle>
                  <DialogDescription>
                    Copy modules — along with their lessons and activities — from another course
                    into {course.title}.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-source-course">Choose course to copy</Label>
                    <Select
                      value={
                        selectedSourceCourseId != null ? String(selectedSourceCourseId) : undefined
                      }
                      onValueChange={(value) => {
                        const nextValue = value ? Number(value) : null;
                        void handleSourceCourseSelection(nextValue);
                      }}
                    >
                      <SelectTrigger id="import-source-course" className="w-full">
                        <SelectValue placeholder="Select course…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCourses.map((sourceCourse) => (
                          <SelectItem key={sourceCourse.id} value={String(sourceCourse.id)}>
                            {sourceCourse.title}
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

                  {selectedSourceCourseId == null ? (
                    <p className="text-sm text-muted-foreground">
                      Select a course to preview its modules.
                    </p>
                  ) : loadingSourceModules ? (
                    <p className="text-sm text-muted-foreground">Loading modules…</p>
                  ) : sourceModules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Selected course has no modules yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Select modules to import (lessons and activities included).
                      </p>
                      <div className="grid max-h-[320px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                        {sourceModules.map((module) => (
                          <label
                            key={module.id}
                            className={`cursor-pointer rounded-[var(--radius-lg)] border p-4 transition ${
                              selectedModuleIds.has(module.id)
                                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                                : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={selectedModuleIds.has(module.id)}
                              onChange={() => toggleModuleSelection(module.id)}
                            />
                            <div className="font-semibold text-foreground">{module.title}</div>
                            {module.description && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {module.description}
                              </div>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleImportOpenChange(false)}
                    disabled={importing}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={onImport}
                    disabled={
                      importing || selectedSourceCourseId == null || selectedModuleIds.size === 0
                    }
                  >
                    {importing
                      ? 'Importing…'
                      : selectedModuleIds.size > 0
                        ? `Import ${selectedModuleIds.size} module${selectedModuleIds.size === 1 ? '' : 's'}`
                        : 'Import modules'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </PermissionGate>

          {oModules.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <IconLayoutGrid size={22} aria-hidden="true" />
                </div>
                <p className="text-sm text-muted-foreground">No modules yet.</p>
              </CardContent>
            </Card>
          ) : (
            <SortableProvider
              ids={oModules.map((m) => m.id)}
              onReorder={reorderModulesList}
              strategy="grid"
              disabled={!perms.canManageContent || oModules.length < 2 || reorderingModules}
            >
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {oModules.map((m, idx) => {
                  const canPublish = course?.isPublished;
                  const blocked = !m.isPublished && !canPublish;
                  const tooltipMessage = blocked
                    ? `Publish ${m.title} after publishing ${course?.title ?? 'the parent course'}.`
                    : null;
                  const busy = publishingId === m.id;
                  const canReorder = perms.canManageContent && oModules.length > 1;
                  return (
                    <SortableItem key={m.id} id={m.id} disabled={!canReorder}>
                      {({ handleProps }) => (
                          <ModuleCard
                            index={idx}
                            title={m.title}
                            description={m.description}
                            accentColor={accentColor}
                            isPublished={m.isPublished}
                            onClick={() => navigate(`/instructor/module/${m.id}`)}
                            leading={
                              canReorder ? (
                                <DragHandle handleProps={handleProps} label={`Drag to reorder ${m.title}`} />
                              ) : undefined
                            }
                            actions={
                              perms.canPublishContent || perms.canManageContent ? (
                                <PublishMenu
                                  isPublished={m.isPublished}
                                  pending={busy}
                                  blockedReason={tooltipMessage}
                                  itemLabel="module"
                                  onToggle={
                                    perms.canPublishContent
                                      ? () => {
                                          if (busy || blocked) return;
                                          setPendingPublish({ id: m.id, isPublished: m.isPublished, title: m.title });
                                        }
                                      : undefined
                                  }
                                  onEdit={perms.canManageContent ? () => openEditModule(m) : undefined}
                                  onDelete={perms.canManageContent ? () => setDeletingModule(m) : undefined}
                                />
                              ) : undefined
                            }
                          />
                      )}
                    </SortableItem>
                  );
                })}
              </div>
            </SortableProvider>
          )}
        </PageTabsContent>

        {tabs.some((tab) => tab.id === 'submissions') && (
          <PageTabsContent value="submissions">
            {numericCourseId ? <CourseSubmissionsPanel courseId={numericCourseId} /> : null}
          </PageTabsContent>
        )}

        {tabs.some((tab) => tab.id === 'analytics') && (
          <PageTabsContent value="analytics" className="space-y-6">
            {numericCourseId ? <CourseAnalyticsPanel courseId={numericCourseId} /> : null}
          </PageTabsContent>
        )}
      </PageTabs>
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
    </div>
  );
}
