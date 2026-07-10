/**
 * @file Instructor course view — the module list inside a single course.
 *
 * Route: /instructor/courses/:courseId
 * Auth: INSTRUCTOR
 * Loads: course detail and its module list, in parallel.
 * Owns: module CRUD entry points (create form), cross-course module import
 *       flow, and the per-module publish toggle.
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
 * Related: routes/instructor.tsx (parent), routes/instructor.topic.tsx (child)
 */
import type { FormEvent } from 'react';
import { useOptimistic, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { IconLayoutGrid } from '@tabler/icons-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeading,
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
} from '@eduai/ui';
import { PublishStatusButton } from '../components/PublishStatusButton';
import api from '../lib/api';
import type { Course, Module } from '../lib/types';
import type { Route } from './+types/instructor.course';
import { requireClientUser } from '~/lib/client-auth';
import { useLocalUser } from '../hooks/useLocalUser';
import { useAtPermissions } from '../hooks/useAtPermissions';
import { CourseAnalyticsPanel } from '../components/courses/CourseAnalyticsPanel';
import { CourseEnrollmentsPanel } from '../components/courses/CourseEnrollmentsPanel';
import { CourseStudentMetricsPanel } from '../components/courses/CourseStudentMetricsPanel';
import { CourseSubmissionsPanel } from '../components/courses/CourseSubmissionsPanel';
import { PermissionGate } from '../components/rbac/PermissionGate';
import { getCourseDetailTabs } from '~/lib/rbac/nav';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { CourseSwitcher } from '~/components/layout/CourseSwitcher';

const SELECT_CLASSES =
  'flex h-9 w-full rounded-[var(--radius-md)] border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 ease-in-out focus-visible:border-ring focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-50';

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
  const [modules, setModules] = useState<Module[]>(initialModules);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [selectedSourceCourseId, setSelectedSourceCourseId] = useState<number | null>(null);
  const [sourceModules, setSourceModules] = useState<Module[]>([]);
  const [loadingSourceCourses, setLoadingSourceCourses] = useState(false);
  const [loadingSourceModules, setLoadingSourceModules] = useState(false);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
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
      await refreshModules();
    } catch (error) {
      console.error('Failed to create module', error);
    } finally {
      setCreating(false);
    }
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

  useShellBreadcrumbs([
    { label: 'Teaching', href: '/instructor' },
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
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <PageHeading heading={course?.title || 'Course'} subheading="Course content and analytics" />
      </div>

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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Modules</h2>
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
                {showImport ? 'Close' : 'Import'}
              </Button>
            </PermissionGate>
          </div>

          <PermissionGate allow={perms.canManageContent}>
            {showImport && (
              <Card>
                <CardContent className="space-y-4 pt-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-source-course">Choose course to copy</Label>
                    <select
                      id="import-source-course"
                      value={selectedSourceCourseId ?? ''}
                      onChange={(e) => {
                        const nextValue = e.target.value ? Number(e.target.value) : null;
                        void handleSourceCourseSelection(nextValue);
                      }}
                      className={SELECT_CLASSES}
                    >
                      <option value="">Select course…</option>
                      {availableCourses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
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
                    <p className="text-sm text-muted-foreground">Selected course has no modules yet.</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Select modules to import (lessons and activities included).
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
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
                      <Button
                        type="button"
                        onClick={onImport}
                        disabled={
                          importing || selectedSourceCourseId == null || selectedModuleIds.size === 0
                        }
                      >
                        {importing ? 'Importing…' : 'Import modules'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </PermissionGate>

          <PermissionGate allow={perms.canManageContent}>
            <form onSubmit={onCreateModule} className="flex gap-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New module title…"
                className="flex-1"
              />
              <Button type="submit" disabled={creating || !title.trim()}>
                {creating ? 'Adding…' : 'Add module'}
              </Button>
            </form>
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
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {oModules.map((m, idx) => {
                const canPublish = course?.isPublished;
                const blocked = !m.isPublished && !canPublish;
                const tooltipMessage = blocked
                  ? `Publish ${m.title} after publishing ${course?.title ?? 'the parent course'}.`
                  : null;
                const busy = publishingId === m.id;
                return (
                  <Card
                    key={m.id}
                    hoverable
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/instructor/module/${m.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/instructor/module/${m.id}`);
                      }
                    }}
                    className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-base transition-colors group-hover:text-primary">
                            {m.title}
                          </CardTitle>
                          {m.description && (
                            <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardFooter className="justify-end">
                      <PermissionGate allow={perms.canPublishContent}>
                        <div
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <PublishStatusButton
                            isPublished={m.isPublished}
                            pending={busy}
                            blockedReason={tooltipMessage}
                            onClick={() => {
                              if (busy || blocked) return;
                              togglePublish(m.id, m.isPublished);
                            }}
                          />
                        </div>
                      </PermissionGate>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </PageTabsContent>

        {tabs.some((tab) => tab.id === 'enrollments') && (
          <PageTabsContent value="enrollments">
            {numericCourseId ? (
              <CourseEnrollmentsPanel
                courseId={numericCourseId}
                canManage={perms.canManageEnrollments}
                canAssignTa={perms.canAssignTaRole}
              />
            ) : null}
          </PageTabsContent>
        )}

        {tabs.some((tab) => tab.id === 'submissions') && (
          <PageTabsContent value="submissions">
            {numericCourseId ? <CourseSubmissionsPanel courseId={numericCourseId} /> : null}
          </PageTabsContent>
        )}

        {tabs.some((tab) => tab.id === 'analytics') && (
          <PageTabsContent value="analytics" className="space-y-6">
            {numericCourseId ? (
              <>
                <CourseStudentMetricsPanel courseId={numericCourseId} />
                <CourseAnalyticsPanel courseId={numericCourseId} />
              </>
            ) : null}
          </PageTabsContent>
        )}
      </PageTabs>
    </div>
  );
}
