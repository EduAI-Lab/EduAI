/**
 * @file Admin console for system settings, enrollments, and bug-report triage.
 *
 * Route: /admin
 * Auth: ADMIN
 * Loads: EduAI API key status, admin users, courses, bug reports, and optional
 *   AI model policy/model-catalog data when the backend exposes those endpoints
 * Owns: Tabbed admin workflows for read-only user oversight, enrollment
 *   management, AI loop policy controls, API key overrides, and bug-report review
 * Gotchas:
 *   - Newer admin AI-policy methods are probed defensively so older backends can
 *     still render the rest of the admin console instead of crashing on missing
 *     client API functions.
 *   - Role management is intentionally informational only here; EduAI owns role
 *     assignments, so the UI shows current roles without attempting a local PATCH.
 *   - AI policy inputs are normalized and clamped in the route so partial or
 *     stale backend payloads still produce a usable form state.
 * Related: `docs/ARCHITECTURE.md`, `server/src/routes/admin.js`,
 *   `server/src/services/aiModelPolicy.js`, `app/lib/api.ts`
 */

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import BugReportsTab from '~/components/admin/BugReportsTab';
import api from '~/lib/api';
import type {
  AdminBugReportRow,
  AdminEnrollmentData,
  AdminUser,
  Course,
  EduAiApiKeyStatus,
} from '~/lib/types';
import type { Route } from './+types/admin';
import { requireClientUser } from '~/lib/client-auth';
import { PageHeading } from '@eduai/ui';
import { AppShell } from '~/components/layout/AppShell';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
import { DashboardStatGrid } from '~/components/dashboard/DashboardStatGrid';
import { buildAdminDashboardStats } from '~/lib/dashboard-stats';
import {
  getApiKeySourceTag,
  loadAdminSettingsData,
} from '~/lib/admin-settings';

type AdminLoaderData = {
  status: EduAiApiKeyStatus;
  users: AdminUser[];
  courses: Course[];
  bugReports: AdminBugReportRow[];
};

type AdminTab = 'users' | 'enrollments' | 'bugReports';

const ADMIN_TABS: AdminTab[] = ['users', 'enrollments', 'bugReports'];

function parseAdminTab(value: string | null): AdminTab {
  if (value && ADMIN_TABS.includes(value as AdminTab)) {
    return value as AdminTab;
  }
  return 'users';
}

/**
 * Load the admin console data needed to render every tab.
 *
 * Why: The route intentionally probes optional admin AI-policy methods before
 * calling them so deployments with an older backend can still serve users,
 * courses, enrollments, and bug reports instead of failing the whole page load.
 */
export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser('ADMIN');

  const [settingsData, users, courses, bugReports] = await Promise.all([
    loadAdminSettingsData(),
    api.listAdminUsers(),
    api.listAdminCourses(),
    api.listAdminBugReports(),
  ]);

  return {
    status: settingsData.status,
    users,
    courses,
    bugReports,
  } satisfies AdminLoaderData;
}

/**
 * Render the admin control surface over users, enrollments, AI settings, and bug reports.
 *
 * Why: Admins are intentionally isolated from student/instructor workflows, so
 * this route centralizes the small set of system-level tasks they are allowed to
 * perform without exposing content-authoring or learner-facing screens.
 */
export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const activeTab = parseAdminTab(searchParams.get('tab'));
  const [users] = useState<AdminUser[]>(loaderData.users);
  const [courses] = useState<Course[]>(loaderData.courses);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(
    loaderData.courses[0]?.id ?? null,
  );
  const [courseEnrollments, setCourseEnrollments] = useState<AdminEnrollmentData | null>(null);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [updatingEnrollmentUserId, setUpdatingEnrollmentUserId] = useState<string | null>(null);
  const [syncingEnrollmentsCourseId, setSyncingEnrollmentsCourseId] = useState<number | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | ''>('');

  const adminStats = useMemo(
    () => buildAdminDashboardStats(users, courses, loaderData.bugReports),
    [users, courses, loaderData.bugReports],
  );

  const sourceTag = getApiKeySourceTag(loaderData.status);

  useEffect(() => {
    if (activeTab !== 'enrollments' || !selectedCourseId) {
      return;
    }

    let cancelled = false;
    setLoadingEnrollments(true);
    api
      .getAdminCourseEnrollments(selectedCourseId)
      .then((data) => {
        if (!cancelled) {
          setCourseEnrollments(data);
          setSelectedStudentId(data.availableStudents[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Could not load course enrollments.');
          setCourseEnrollments(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingEnrollments(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedCourseId]);

  const refreshSelectedCourseEnrollments = async (courseId: number) => {
    setLoadingEnrollments(true);
    try {
      const data = await api.getAdminCourseEnrollments(courseId);
      setCourseEnrollments(data);
      setSelectedStudentId((current) => {
        if (
          typeof current === 'string' &&
          data.availableStudents.some((student) => student.id === current)
        ) {
          return current;
        }
        return data.availableStudents[0]?.id ?? '';
      });
    } catch {
      toast.error('Could not load course enrollments.');
      setCourseEnrollments(null);
    } finally {
      setLoadingEnrollments(false);
    }
  };

  const enrollStudent = async () => {
    if (!selectedCourseId || typeof selectedStudentId !== 'string' || !selectedStudentId) {
      return;
    }

    setUpdatingEnrollmentUserId(selectedStudentId);
    try {
      await api.enrollStudentInCourse(selectedCourseId, selectedStudentId);
      await refreshSelectedCourseEnrollments(selectedCourseId);
      toast.success('Student enrolled successfully.');
    } catch {
      toast.error('Could not enroll student. Please try again.');
    } finally {
      setUpdatingEnrollmentUserId(null);
    }
  };

  const syncEnrollmentsFromEduAi = async () => {
    if (!selectedCourseId) return;
    setSyncingEnrollmentsCourseId(selectedCourseId);
    try {
      await api.adminSyncCourseEnrollments(selectedCourseId);
      await refreshSelectedCourseEnrollments(selectedCourseId);
      toast.success('Enrollments synced from EduAI.');
    } catch {
      toast.error('Could not sync enrollments. Only EduAI-imported courses support sync.');
    } finally {
      setSyncingEnrollmentsCourseId(null);
    }
  };

  const removeEnrollment = async (userId: string) => {
    if (!selectedCourseId) {
      return;
    }

    setUpdatingEnrollmentUserId(userId);
    try {
      await api.removeStudentFromCourse(selectedCourseId, userId);
      await refreshSelectedCourseEnrollments(selectedCourseId);
      toast.success('Student removed from course.');
    } catch {
      toast.error('Could not remove enrollment. Please try again.');
    } finally {
      setUpdatingEnrollmentUserId(null);
    }
  };

  if (searchParams.get('tab') === 'settings') {
    return <Navigate to="/settings" replace />;
  }

  return (
    <AppShell breadcrumbs={<ShellBreadcrumbs items={[{ label: 'Admin' }]} />}>
      <div className="space-y-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <PageHeading
            heading="Admin console"
            subheading="Manage users, enrollments, and bug report triage."
          />
          <div className={sourceTag.className}>{sourceTag.label}</div>
        </div>

        <DashboardStatGrid stats={adminStats} />

        {activeTab === 'users' ? (
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 sm:p-8 space-y-6 animate-fade-up delay-150">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">User Management</h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                User roles are now read-only in AI Tutor. Identity and role changes are managed in
                EduAI and synced on sign-in.
              </p>
            </div>

            <div className="space-y-3">
              {users.length === 0 ? (
                <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                  No users found.
                </div>
              ) : (
                users.map((user) => {
                  return (
                    <div
                      key={user.id}
                      className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/80 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">{user.name}</h3>
                          <span className="tag">{user.role}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : activeTab === 'enrollments' ? (
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 sm:p-8 space-y-6 animate-fade-up delay-150">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">Course Enrollments</h2>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Students only see courses they are enrolled in. Use this tab to manage those
                relationships directly.
              </p>
            </div>

            {courses.length === 0 ? (
              <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                No courses found.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">Select course</label>
                  <select
                    value={selectedCourseId ?? ''}
                    onChange={(e) => {
                      const nextCourseId = Number(e.target.value);
                      setSelectedCourseId(Number.isFinite(nextCourseId) ? nextCourseId : null);
                    }}
                    className="input-field"
                  >
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => void syncEnrollmentsFromEduAi()}
                    disabled={!selectedCourseId || syncingEnrollmentsCourseId !== null}
                    className="btn-secondary text-sm"
                  >
                    {syncingEnrollmentsCourseId === selectedCourseId
                      ? 'Syncing…'
                      : 'Sync enrollments from EduAI'}
                  </button>
                </div>

                {loadingEnrollments ? (
                  <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                    Loading enrollments…
                  </div>
                ) : !courseEnrollments ? (
                  <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                    Choose a course to manage its enrollments.
                  </div>
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
                      <div className="space-y-1">
                        <h3 className="font-semibold text-foreground">Add Student</h3>
                        <p className="text-sm text-muted-foreground">
                          Only student accounts can be enrolled in a course.
                        </p>
                      </div>

                      <select
                        value={selectedStudentId}
                        onChange={(e) => {
                          setSelectedStudentId(e.target.value || '');
                        }}
                        className="input-field"
                        disabled={courseEnrollments.availableStudents.length === 0}
                      >
                        {courseEnrollments.availableStudents.length === 0 ? (
                          <option value="">No students available</option>
                        ) : (
                          courseEnrollments.availableStudents.map((student) => (
                            <option key={student.id} value={student.id}>
                              {student.name || student.id}
                              {student.email ? ` (${student.email})` : ''}
                            </option>
                          ))
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={enrollStudent}
                        disabled={!selectedStudentId || updatingEnrollmentUserId !== null}
                        className="btn-primary"
                      >
                        Enroll student
                      </button>
                    </div>

                    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
                      <div className="space-y-1">
                        <h3 className="font-semibold text-foreground">Enrolled Students</h3>
                        <p className="text-sm text-muted-foreground">
                          Removing an enrollment immediately removes course visibility for that
                          student.
                        </p>
                      </div>

                      {courseEnrollments.enrolledStudents.length === 0 ? (
                        <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                          No students are enrolled in this course yet.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {courseEnrollments.enrolledStudents.map((student) => (
                            <div
                              key={student.id}
                              className="flex flex-col gap-3 rounded-xl border border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-foreground">
                                    {student.name || student.id}
                                  </span>
                                  {student.name && student.name !== student.id ? (
                                    <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                                      {student.id}
                                    </span>
                                  ) : null}
                                </div>
                                {student.email ? (
                                  <div className="text-sm text-muted-foreground">{student.email}</div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeEnrollment(student.id)}
                                disabled={updatingEnrollmentUserId === student.id}
                                className="btn-secondary text-sm"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <BugReportsTab initialReports={loaderData.bugReports} />
        )}
      </div>
    </AppShell>
  );
}

