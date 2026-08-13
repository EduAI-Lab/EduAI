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
import { useNavigate, useNavigation, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { IconDownload, IconLayoutGrid, IconPlus } from '@tabler/icons-react';
import {
  Button,
  Card,
  ConfirmDialog,
  CourseHeroCard,
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
import api, { FULL_TREE_READ_PAGE_SIZE } from '../lib/api';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/instructor.course';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '../hooks/useLocalUser';
import { useAtPermissions } from '../hooks/useAtPermissions';
import { CourseAnalyticsPanel } from '../components/courses/CourseAnalyticsPanel';
import { CourseTopicsHeroAction } from '../components/courses/CourseTopicsHeroAction';
import { CourseFeedbackPanel } from '../components/courses/CourseFeedbackPanel';
import { CourseSubmissionsPanel } from '../components/courses/CourseSubmissionsPanel';
import { PermissionGate } from '@eduai/ui';
import { getCourseDetailTabs } from '~/lib/rbac/nav';
import { useCourseTopics } from '../hooks/useCourseTopics';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';
import { PaginationControls } from '~/components/common/PaginationControls';
import { ListSearchInput } from '~/components/common/ListSearchInput';
import { MoveToPositionDialog } from '~/components/common/MoveToPositionDialog';
import {
  absoluteOrdinal,
  movedRowIndex,
  parseListUrlParams,
  redirectPastEnd,
} from '~/lib/list-params';

/**
 * Loads the course header and its modules in parallel. Throws a 400 Response
 * if the route param isn't numeric so the router renders the error boundary.
 */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  await requireClientUser(['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN']);
  const courseId = Number(params.courseId);
  if (!Number.isFinite(courseId)) {
    throw new Response('Invalid course id', { status: 400 });
  }

  // #1207: page and search both live in the URL, so the list is bookmarkable
  // and survives reload. `search` is applied server-side — nothing below
  // filters `modulesPage.data` again.
  const { page, search } = parseListUrlParams(request);

  const [course, modulesPage] = await Promise.all([
    api.courseById(courseId) as Promise<Course>,
    api.modulesForCourse(courseId, { page, search }),
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
    search,
  };
}

/**
 * Module list for one course. Hosts module creation, the cross-course import
 * panel, and the publish toggle whose enablement depends on the parent
 * course's published state.
 */
export default function InstructorCourseModules({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const { courseId } = useParams();
  const numericCourseId = courseId ? Number(courseId) : null;
  const { user } = useLocalUser();
  const perms = useAtPermissions();
  const tabs = getCourseDetailTabs(user ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits } : null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('content');
  const {
    course,
    modules: initialModules,
    modulesTotal: initialModulesTotal,
    page,
    pageSize,
    search,
  } = loaderData;
  const accentColor = accentForCourse(course);
  const courseTopics = useCourseTopics(numericCourseId);
  const [modules, setModules] = useState<Module[]>(initialModules);
  // `total` is state, not a loader constant — refresh/create/import all replace
  // `modules`, and the pager reads this.
  const [modulesTotal, setModulesTotal] = useState(initialModulesTotal);
  // #1207: reorder is no longer disabled past the page bound — a drag persists
  // an absolute ordinal via `PATCH /modules/:id/position`, so the rows this
  // page never loaded get shifted server-side. It IS disabled while a search is
  // active: a filtered list hides the rows between two visible matches, so a
  // drop index doesn't describe a real destination.
  const [movingModule, setMovingModule] = useState<Module | null>(null);
  const searching = search !== '';
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
    setModulesTotal(initialModulesTotal);
  }

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

  // Narrowing the term invalidates the current page number, so reset to page 1
  // alongside it — otherwise `?page=7` against 3 pages of matches would bounce
  // through the loader's past-the-end redirect on every keystroke.
  const setModuleSearch = (term: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (term === '') next.delete('search');
      else next.set('search', term);
      next.delete('page');
      return next;
    });
  };

  // Refetch the CURRENT page and term (#1207) — refetching page 1 would jump
  // the user somewhere else after every create/delete/reorder.
  const refreshModules = async () => {
    if (!numericCourseId) return;
    try {
      const modulesData = await api.modulesForCourse(numericCourseId, { page, search });
      setModules(modulesData.data);
      setModulesTotal(modulesData.total);
    } catch (error) {
      console.error('Failed to refresh modules', error);
    }
  };

  /**
   * Land the instructor on the page that actually contains a just-created
   * module (#1207).
   *
   * A new module is appended, so it lands on the last page — while the pager is
   * usually sitting on an earlier one, and an active search almost certainly
   * doesn't match the new title. Plain `refreshModules()` would then redraw the
   * same rows, the dialog would close over an unchanged grid, and the create
   * would read as a silent failure.
   */
  const revealNewestModule = async () => {
    // `+ 1`: state still holds the pre-create count. `modulesTotal` counts
    // matches while a search is active, so ask the server for the real count.
    let unfilteredTotal = modulesTotal + 1;
    if (searching && numericCourseId) {
      try {
        unfilteredTotal = (await api.modulesForCourse(numericCourseId, { page: 1, search: '' }))
          .total;
      } catch (error) {
        console.error('Failed to count modules after create', error);
      }
    }

    const lastPage = Math.max(1, Math.ceil(unfilteredTotal / pageSize));
    if (searching || page !== lastPage) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        next.set('page', String(lastPage));
        return next;
      });
      return;
    }
    await refreshModules();
  };

  const ensureSourceCoursesLoaded = () => {
    if (availableCourses.length > 0) return;
    setLoadingSourceCourses(true);
    api
      .listCourses()
      .then((page) => {
        const data = page.data;
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
      const data = await api.modulesForCourse(nextCourseId, {
        pageSize: FULL_TREE_READ_PAGE_SIZE,
      });
      if (modulesRequestIdRef.current === requestId) {
        setSourceModules(data.data);
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
      await revealNewestModule();
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

  /**
   * Persist a single module move to an absolute ordinal (#1207).
   *
   * Both entry points land here: a drag supplies the row's new index on the
   * current page, which becomes `(page - 1) * pageSize + index`; the "Move to
   * position…" dialog supplies the ordinal directly. Sending one ordinal rather
   * than a full ordered id list is what lets this work on page 3 — the server
   * shifts the siblings this page never loaded.
   *
   * The page is refetched afterwards rather than patched locally, because a
   * move can push this row (or another) onto a different page entirely.
   */
  const moveModule = async (moduleId: number, targetOrdinal: number) => {
    const current = modules;
    setReorderingModules(true);
    try {
      await api.moveModuleToPosition(moduleId, targetOrdinal);
      await refreshModules();
    } catch (error) {
      console.error('Failed to move module', error);
      toast.error('Failed to reorder modules. The previous order was restored.');
      setModules(current);
    } finally {
      setReorderingModules(false);
      setMovingModule(null);
    }
  };

  // Drag-drop handler. `SortableProvider` hands back the ids in their new
  // on-page order; `movedRowIndex` recovers which row was dragged.
  const reorderModulesList = async (orderedIds: number[]) => {
    if (!numericCourseId || searching) return;
    const previousIds = modules.map((m) => m.id);
    const movedIndex = movedRowIndex(orderedIds, previousIds);
    if (movedIndex === -1) return;

    const byId = new Map(modules.map((m) => [m.id, m]));
    const next = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Module[];
    if (next.length !== modules.length) {
      // Dropped order came from a stale render (list changed mid-drag); refetch
      // rather than persisting a move against a list we no longer have.
      toast.error('The module list changed while reordering. Refreshing — please try again.');
      await refreshModules();
      return;
    }
    // Show the dropped order immediately so the card doesn't snap back while
    // the request is in flight.
    setModules(next);

    await moveModule(orderedIds[movedIndex], absoluteOrdinal(page, pageSize, movedIndex));
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
          // #1207: the chip row shows a page of topics; append a "+N more" chip
          // rather than ending silently at the page bound.
          topics={[
            ...courseTopics.topics.map((topic) => topic.name),
            ...(courseTopics.total > courseTopics.topics.length
              ? [`+${courseTopics.total - courseTopics.topics.length} more`]
              : []),
          ]}
          topRightBadges={[course.isPublished ? 'Published' : 'Draft']}
          topicsAction={<CourseTopicsHeroAction course={course} courseTopics={courseTopics} />}
        />
      }
    >
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

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <ListSearchInput
              value={search}
              label="Search modules"
              placeholder="Search modules…"
              onSearchChange={setModuleSearch}
            />
            {searching && perms.canManageContent ? (
              <p className="text-sm text-muted-foreground">
                Clear the search to reorder modules.
              </p>
            ) : null}
          </div>

          {oModules.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconLayoutGrid size={22} aria-hidden="true" />}
                title={searching ? 'No modules match your search.' : 'No modules yet.'}
              />
            </Card>
          ) : (
            <SortableProvider
              ids={oModules.map((m) => m.id)}
              onReorder={reorderModulesList}
              strategy="grid"
              disabled={
                !perms.canManageContent ||
                modulesTotal < 2 ||
                reorderingModules ||
                searching
              }
            >
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {oModules.map((m, idx) => {
                  const canPublish = course?.isPublished;
                  const blocked = !m.isPublished && !canPublish;
                  const tooltipMessage = blocked
                    ? `Publish ${m.title} after publishing ${course?.title ?? 'the parent course'}.`
                    : null;
                  const busy = publishingId === m.id;
                  const canReorder = perms.canManageContent && modulesTotal > 1 && !searching;
                  return (
                    <SortableItem key={m.id} id={m.id} disabled={!canReorder}>
                      {({ handleProps }) => (
                          <ModuleCard
                            // Absolute ordinal, so numbering continues across
                            // pages instead of restarting at 1 on page 2.
                            index={absoluteOrdinal(page, pageSize, idx)}
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
                                  // Cross-page move: drag can only reach rows
                                  // on this page, so anything further needs an
                                  // explicit destination (#1207).
                                  onMove={
                                    perms.canManageContent && modulesTotal > 1 && !searching
                                      ? () => setMovingModule(m)
                                      : undefined
                                  }
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

          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={modulesTotal}
            onPageChange={goToPage}
            disabled={navigation.state === 'loading' || reorderingModules}
          />
        </PageTabsContent>


        {tabs.some((tab) => tab.id === 'feedback') && (
          <PageTabsContent value="feedback">
            {numericCourseId ? <CourseFeedbackPanel courseId={numericCourseId} /> : null}
          </PageTabsContent>
        )}

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
      <MoveToPositionDialog
        open={movingModule !== null}
        onOpenChange={(open) => {
          if (!open) setMovingModule(null);
        }}
        itemTitle={movingModule?.title ?? ''}
        itemNoun="module"
        currentPosition={
          movingModule
            ? absoluteOrdinal(page, pageSize, modules.findIndex((m) => m.id === movingModule.id)) + 1
            : 1
        }
        total={modulesTotal}
        submitting={reorderingModules}
        onSubmit={(position) => {
          if (movingModule) return moveModule(movingModule.id, position);
        }}
      />
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
