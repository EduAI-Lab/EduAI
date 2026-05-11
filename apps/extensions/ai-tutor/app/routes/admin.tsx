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
import BugReportsTab from '~/components/admin/BugReportsTab';
import Nav from '~/components/Nav';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

type CostTier = 'LOW' | 'MEDIUM' | 'HIGH';

type AdminAiModelPolicy = {
  allowedTutorModelIds: string[];
  defaultTutorModelId: string | null;
  defaultSupervisorModelId: string | null;
  dualLoopEnabled: boolean;
  maxSupervisorIterations: number;
};

type AdminAiModelOption = {
  id: string;
  modelId: string;
  modelName: string;
  provider?: string | null;
  summary?: string | null;
  costTier?: CostTier | null;
};

type AdminLoaderData = {
  status: EduAiApiKeyStatus;
  users: AdminUser[];
  courses: Course[];
  bugReports: AdminBugReportRow[];
  aiPolicy: AdminAiModelPolicy | null;
  aiModels: AdminAiModelOption[];
  aiPolicyAvailable: boolean;
  aiPolicyError: string | null;
};

type AdminSettingsApi = {
  getAdminAiModelPolicy?: () => Promise<unknown>;
  setAdminAiModelPolicy?: (payload: AdminAiModelPolicy) => Promise<unknown>;
  listAiModels?: () => Promise<unknown>;
};

const DEFAULT_POLICY: AdminAiModelPolicy = {
  allowedTutorModelIds: [],
  defaultTutorModelId: null,
  defaultSupervisorModelId: null,
  dualLoopEnabled: true,
  maxSupervisorIterations: 3,
};

function getAdminSettingsApi(): AdminSettingsApi {
  return api as typeof api & AdminSettingsApi;
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
  const settingsApi = getAdminSettingsApi();
  // These methods landed after the rest of the admin API. Treat them as
  // optional so the page degrades gracefully against older servers.
  const aiPolicyAvailable =
    typeof settingsApi.getAdminAiModelPolicy === 'function' &&
    typeof settingsApi.setAdminAiModelPolicy === 'function';

  const [status, users, courses, bugReports, aiModelsResult, aiPolicyResult] = await Promise.all([
    api.getEduAiApiKeyStatus(),
    api.listAdminUsers(),
    api.listAdminCourses(),
    api.listAdminBugReports(),
    loadAdminAiModels(settingsApi),
    loadAdminAiPolicy(settingsApi),
  ]);

  return {
    status,
    users,
    courses,
    bugReports,
    aiModels: aiModelsResult.models,
    aiPolicy: aiPolicyResult.policy,
    aiPolicyError: aiPolicyResult.error,
    aiPolicyAvailable,
  } satisfies AdminLoaderData;
}

function formatTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

/**
 * Render the admin control surface over users, enrollments, AI settings, and bug reports.
 *
 * Why: Admins are intentionally isolated from student/instructor workflows, so
 * this route centralizes the small set of system-level tasks they are allowed to
 * perform without exposing content-authoring or learner-facing screens.
 */
export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const settingsApi = getAdminSettingsApi();
  const [activeTab, setActiveTab] = useState<'users' | 'enrollments' | 'settings' | 'bugReports'>(
    'users',
  );
  const [status, setStatus] = useState<EduAiApiKeyStatus>(loaderData.status);
  const [users, setUsers] = useState<AdminUser[]>(loaderData.users);
  const [courses] = useState<Course[]>(loaderData.courses);
  const [aiPolicy, setAiPolicy] = useState<AdminAiModelPolicy>(
    normalizePolicy(loaderData.aiPolicy ?? DEFAULT_POLICY, loaderData.aiModels),
  );
  const [initialAiPolicy, setInitialAiPolicy] = useState<AdminAiModelPolicy>(
    normalizePolicy(loaderData.aiPolicy ?? DEFAULT_POLICY, loaderData.aiModels),
  );
  const [aiModels] = useState<AdminAiModelOption[]>(loaderData.aiModels);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(
    loaderData.courses[0]?.id ?? null,
  );
  const [courseEnrollments, setCourseEnrollments] = useState<AdminEnrollmentData | null>(null);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [updatingEnrollmentUserId, setUpdatingEnrollmentUserId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | ''>('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savingAiPolicy, setSavingAiPolicy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loaderData.aiPolicyError);

  const updatedLabel = useMemo(() => formatTime(status.updatedAt), [status.updatedAt]);
  const aiPolicyAvailable = loaderData.aiPolicyAvailable;
  const hasAllowedTutorModels = aiPolicy.allowedTutorModelIds.length > 0;
  const aiPolicyDirty = useMemo(() => {
    return JSON.stringify(initialAiPolicy) !== JSON.stringify(aiPolicy);
  }, [aiPolicy, initialAiPolicy]);

  const sourceTag = (() => {
    if (!status.configured) return { label: 'Not configured', className: 'tag' };
    if (status.source === 'ADMIN') return { label: 'Admin override', className: 'tag tag-primary' };
    if (status.source === 'ENV') return { label: 'From .env', className: 'tag tag-accent' };
    return { label: 'Configured', className: 'tag' };
  })();

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
          setError('Could not load course enrollments.');
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
      setError('Could not load course enrollments.');
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
    setError(null);
    setMessage(null);
    try {
      await api.enrollStudentInCourse(selectedCourseId, selectedStudentId);
      await refreshSelectedCourseEnrollments(selectedCourseId);
      setMessage('Student enrolled successfully.');
    } catch {
      setError('Could not enroll student. Please try again.');
    } finally {
      setUpdatingEnrollmentUserId(null);
    }
  };

  const removeEnrollment = async (userId: string) => {
    if (!selectedCourseId) {
      return;
    }

    setUpdatingEnrollmentUserId(userId);
    setError(null);
    setMessage(null);
    try {
      await api.removeStudentFromCourse(selectedCourseId, userId);
      await refreshSelectedCourseEnrollments(selectedCourseId);
      setMessage('Student removed from course.');
    } catch {
      setError('Could not remove enrollment. Please try again.');
    } finally {
      setUpdatingEnrollmentUserId(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.setEduAiApiKey(apiKey);
      setStatus(next);
      setApiKey('');
      setMessage('Saved. This overrides EDUAI_API_KEY from the environment.');
    } catch (e) {
      setError('Could not save key. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.clearEduAiApiKey();
      setStatus(next);
      setMessage(
        'Cleared admin override. The server will fall back to EDUAI_API_KEY from the environment.',
      );
    } catch {
      setError('Could not clear override. Please try again.');
    } finally {
      setClearing(false);
    }
  };

  const toggleTutorModel = (modelId: string) => {
    setAiPolicy((current) => {
      const nextAllowed = current.allowedTutorModelIds.includes(modelId)
        ? current.allowedTutorModelIds.filter((id) => id !== modelId)
        : [...current.allowedTutorModelIds, modelId];

      const fallbackTutor =
        current.defaultTutorModelId && nextAllowed.includes(current.defaultTutorModelId)
          ? current.defaultTutorModelId
          : (nextAllowed[0] ?? null);

      return {
        ...current,
        allowedTutorModelIds: nextAllowed,
        defaultTutorModelId: fallbackTutor,
      };
    });
  };

  const saveAiPolicy = async () => {
    if (!aiPolicyAvailable || typeof settingsApi.setAdminAiModelPolicy !== 'function') {
      setError('AI model settings are not wired into the client API yet.');
      return;
    }

    setSavingAiPolicy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await settingsApi.setAdminAiModelPolicy(aiPolicy);
      const normalized = normalizePolicy(saved, aiModels);
      setAiPolicy(normalized);
      setInitialAiPolicy(normalized);
      setMessage('AI loop settings saved.');
    } catch {
      setError('Could not save AI loop settings. Please try again.');
    } finally {
      setSavingAiPolicy(false);
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
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-up">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Admin</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Settings
            </h1>
          </div>
          <div className={sourceTag.className}>{sourceTag.label}</div>
        </header>

        <div className="flex flex-wrap gap-3 animate-fade-up delay-150">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}
          >
            User Management
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('enrollments')}
            className={activeTab === 'enrollments' ? 'btn-primary' : 'btn-secondary'}
          >
            Enrollments
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}
          >
            EduAI Settings
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bugReports')}
            className={activeTab === 'bugReports' ? 'btn-primary' : 'btn-secondary'}
          >
            Bug Reports
          </button>
        </div>

        {(error || message) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              error
                ? 'bg-destructive/10 border-destructive/20 text-destructive'
                : 'bg-accent/10 border-accent/20 text-accent-foreground'
            }`}
          >
            {error ?? message}
          </div>
        )}

        {activeTab === 'users' ? (
          <div className="card-editorial p-6 sm:p-8 space-y-6 animate-fade-up delay-150">
            <div className="space-y-2">
              <h2 className="font-display text-xl font-bold text-foreground">User Management</h2>
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
          <div className="card-editorial p-6 sm:p-8 space-y-6 animate-fade-up delay-150">
            <div className="space-y-2">
              <h2 className="font-display text-xl font-bold text-foreground">Course Enrollments</h2>
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
                              {student.name} ({student.email})
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
                                <div className="font-medium text-foreground">{student.name}</div>
                                <div className="text-sm text-muted-foreground">{student.email}</div>
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
        ) : activeTab === 'settings' ? (
          <div className="space-y-6 animate-fade-up delay-150">
            <div className="card-editorial p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-bold text-foreground">AI loop policy</h2>
                  <InfoBadge copy="A loop is the handoff between the student-facing tutor and the internal supervisor that checks each draft before it is shown." />
                </div>
                <p className="text-sm text-muted-foreground max-w-3xl">
                  Configure the safe defaults for how student help responses are generated. Students
                  can still bring their own provider keys, but they will only be able to choose
                  tutor models from the allowlist you approve here. The supervisor remains fully
                  admin-controlled.
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Tutor</h3>
                    <InfoBadge copy="The tutor is the student-facing assistant. It should be fast, clear, and Socratic rather than answer-revealing." />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Students may override this model, but only within the tutor allowlist below.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Supervisor</h3>
                    <InfoBadge copy="The supervisor is an internal reviewer. It sees hidden answer-aware context, rejects risky drafts, and proposes revisions or a safe fallback." />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Keep this stable and safety-oriented. Students cannot change it.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card/80 p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Cost guidance</h3>
                    <InfoBadge copy="Costs are qualitative here on purpose. Use these labels to weigh speed and quality without depending on fragile exact vendor pricing." />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Low-cost models are best for routine hints. Higher-cost models are better when
                    you want more careful supervision or stronger reasoning.
                  </p>
                </div>
              </div>

              {!aiPolicyAvailable ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                  AI model policy endpoints are not wired into the client API yet. This UI is ready
                  for the contract, but saving is temporarily disabled until the shared client layer
                  lands.
                </div>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground">Allowed tutor models</h3>
                    <p className="text-sm text-muted-foreground">
                      Students can only choose from the models you allow here.
                    </p>
                  </div>

                  {aiModels.length === 0 ? (
                    <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                      No AI models are available yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {aiModels.map((model) => {
                        const isAllowed = aiPolicy.allowedTutorModelIds.includes(model.modelId);
                        const isTutorDefault = aiPolicy.defaultTutorModelId === model.modelId;
                        const isSupervisorDefault =
                          aiPolicy.defaultSupervisorModelId === model.modelId;

                        return (
                          <label
                            key={model.id}
                            className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 transition-colors sm:flex-row sm:items-start sm:justify-between ${
                              isAllowed
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-border/70 bg-background/60 hover:border-primary/20'
                            }`}
                          >
                            <div className="flex gap-3">
                              <input
                                type="checkbox"
                                checked={isAllowed}
                                onChange={() => toggleTutorModel(model.modelId)}
                                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                              />
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-foreground">
                                    {model.modelName}
                                  </span>
                                  <span className="tag">
                                    {model.provider ?? inferProvider(model.modelId)}
                                  </span>
                                  <span className={costTierClassName(model.costTier)}>
                                    {formatCostTier(model.costTier)}
                                  </span>
                                  {isTutorDefault ? (
                                    <span className="tag tag-primary">Tutor default</span>
                                  ) : null}
                                  {isSupervisorDefault ? (
                                    <span className="tag tag-accent">Supervisor default</span>
                                  ) : null}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {model.summary ?? buildFallbackSummary(model)}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {model.modelId}
                                </p>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-5">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground">Loop defaults</h3>
                    <p className="text-sm text-muted-foreground">
                      These defaults apply across teach, guide, and custom activity modes in this
                      phase.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">Enable dual loop</span>
                          <InfoBadge copy="When enabled, the tutor drafts a reply and the supervisor reviews it before the student sees it." />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Turning this off falls back to a single tutor pass.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAiPolicy((current) => ({
                            ...current,
                            dualLoopEnabled: !current.dualLoopEnabled,
                          }))
                        }
                        className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                          aiPolicy.dualLoopEnabled ? 'bg-primary' : 'bg-secondary'
                        }`}
                        aria-pressed={aiPolicy.dualLoopEnabled}
                      >
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                            aiPolicy.dualLoopEnabled ? 'translate-x-7' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      Default tutor model
                    </label>
                    <select
                      value={aiPolicy.defaultTutorModelId ?? ''}
                      onChange={(e) =>
                        setAiPolicy((current) => ({
                          ...current,
                          defaultTutorModelId: e.target.value || null,
                        }))
                      }
                      className="input-field"
                      disabled={!hasAllowedTutorModels}
                    >
                      {!hasAllowedTutorModels ? (
                        <option value="">Choose allowed tutor models first</option>
                      ) : (
                        aiModels
                          .filter((model) => aiPolicy.allowedTutorModelIds.includes(model.modelId))
                          .map((model) => (
                            <option key={model.id} value={model.modelId}>
                              {model.modelName}
                            </option>
                          ))
                      )}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      Default supervisor model
                    </label>
                    <select
                      value={aiPolicy.defaultSupervisorModelId ?? ''}
                      onChange={(e) =>
                        setAiPolicy((current) => ({
                          ...current,
                          defaultSupervisorModelId: e.target.value || null,
                        }))
                      }
                      className="input-field"
                      disabled={!aiModels.length}
                    >
                      {!aiModels.length ? (
                        <option value="">No models available</option>
                      ) : (
                        aiModels.map((model) => (
                          <option key={model.id} value={model.modelId}>
                            {model.modelName}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Pick the more careful model here, even if it is slower or more expensive.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      Max revision passes
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={aiPolicy.maxSupervisorIterations}
                      onChange={(e) =>
                        setAiPolicy((current) => ({
                          ...current,
                          maxSupervisorIterations: clampIterations(e.target.value),
                        }))
                      }
                      className="input-field"
                    />
                    <p className="text-xs text-muted-foreground">
                      Three passes is a good default: enough room for correction without producing a
                      slow experience.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm text-muted-foreground space-y-2">
                    <p className="font-medium text-foreground">Before you save</p>
                    <p>
                      Choose at least one tutor model, then set a tutor default and a supervisor
                      default. Tutor defaults shape the student experience. Supervisor defaults
                      shape safety.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={saveAiPolicy}
                      disabled={
                        savingAiPolicy ||
                        !aiPolicyAvailable ||
                        !aiPolicyDirty ||
                        !hasAllowedTutorModels ||
                        !aiPolicy.defaultTutorModelId ||
                        !aiPolicy.defaultSupervisorModelId
                      }
                      className="btn-primary"
                    >
                      {savingAiPolicy ? 'Saving…' : 'Save loop settings'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiPolicy(initialAiPolicy)}
                      disabled={savingAiPolicy || !aiPolicyDirty}
                      className="btn-secondary"
                    >
                      Reset changes
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card-editorial p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <h2 className="font-display text-xl font-bold text-foreground">EduAI API Key</h2>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  {status.envConfigured ? (
                    <>
                      <span className="font-mono">EDUAI_API_KEY</span> is already configured in your
                      server environment (for example via <span className="font-mono">.env</span>).
                      Saving a key here will override it. Clear the override to fall back to the
                      environment value.
                    </>
                  ) : (
                    <>
                      No <span className="font-mono">EDUAI_API_KEY</span> is configured in your
                      server environment (for example via <span className="font-mono">.env</span>).
                      You can set one here.
                    </>
                  )}
                </p>
                {updatedLabel && status.hasAdminOverride && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: <span className="font-mono">{updatedLabel}</span>
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-foreground">New key</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type={showKey ? 'text' : 'password'}
                    className="input-field flex-1"
                    placeholder="Paste EDUAI API key"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="btn-secondary text-sm"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !apiKey.trim()}
                  className="btn-primary"
                >
                  {saving ? 'Saving…' : 'Save key'}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  disabled={clearing || !status.hasAdminOverride}
                  className="btn-secondary"
                  title={!status.hasAdminOverride ? 'No admin override to clear' : undefined}
                >
                  {clearing ? 'Clearing…' : 'Clear override'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <BugReportsTab initialReports={loaderData.bugReports} />
        )}
      </div>
    </div>
  );
}

function normalizePolicy(raw: unknown, models: AdminAiModelOption[]): AdminAiModelPolicy {
  const fallbackTutor = models[0]?.modelId ?? null;
  const allowedTutorModelIds = Array.isArray(
    (raw as { allowedTutorModelIds?: unknown })?.allowedTutorModelIds,
  )
    ? (raw as { allowedTutorModelIds: unknown[] }).allowedTutorModelIds.filter(
        (value): value is string => typeof value === 'string',
      )
    : fallbackTutor
      ? [fallbackTutor]
      : [];

  const defaultTutorModelId =
    typeof (raw as { defaultTutorModelId?: unknown })?.defaultTutorModelId === 'string'
      ? (raw as { defaultTutorModelId: string }).defaultTutorModelId
      : (allowedTutorModelIds[0] ?? null);

  return {
    allowedTutorModelIds,
    defaultTutorModelId:
      defaultTutorModelId && allowedTutorModelIds.includes(defaultTutorModelId)
        ? defaultTutorModelId
        : (allowedTutorModelIds[0] ?? null),
    defaultSupervisorModelId:
      typeof (raw as { defaultSupervisorModelId?: unknown })?.defaultSupervisorModelId === 'string'
        ? (raw as { defaultSupervisorModelId: string }).defaultSupervisorModelId
        : (models[0]?.modelId ?? null),
    dualLoopEnabled:
      typeof (raw as { dualLoopEnabled?: unknown })?.dualLoopEnabled === 'boolean'
        ? (raw as { dualLoopEnabled: boolean }).dualLoopEnabled
        : true,
    // The backend clamps this too, but the form state does it locally so older
    // payloads or partial saves never leave the admin UI in an impossible state.
    maxSupervisorIterations:
      typeof (raw as { maxSupervisorIterations?: unknown })?.maxSupervisorIterations === 'number'
        ? Math.max(
            1,
            Math.min(5, (raw as { maxSupervisorIterations: number }).maxSupervisorIterations),
          )
        : DEFAULT_POLICY.maxSupervisorIterations,
  };
}

/**
 * Fetch the persisted AI policy when the client API exposes that capability.
 *
 * Why: This route treats policy loading as optional because the rest of the
 * admin console remains useful even against a backend that has not shipped the
 * newer AI-policy endpoints yet.
 */
async function loadAdminAiPolicy(settingsApi: AdminSettingsApi) {
  if (typeof settingsApi.getAdminAiModelPolicy !== 'function') {
    return { policy: null, error: null };
  }

  try {
    const policy = await settingsApi.getAdminAiModelPolicy();
    return { policy: policy as AdminAiModelPolicy, error: null };
  } catch {
    return {
      policy: null,
      error:
        'AI model settings could not be loaded. The rest of the admin tools are still available.',
    };
  }
}

/**
 * Fetch the AI model catalog for admin policy controls when supported by the API.
 *
 * Why: Model metadata is helpful but not essential, so failures collapse to an
 * empty list instead of blocking unrelated admin tasks.
 */
async function loadAdminAiModels(settingsApi: AdminSettingsApi) {
  if (typeof settingsApi.listAiModels !== 'function') {
    return { models: [] as AdminAiModelOption[] };
  }

  try {
    const models = await settingsApi.listAiModels();
    const normalized = Array.isArray(models)
      ? models
          .map((model, index) => normalizeModelOption(model, index))
          .filter((model): model is AdminAiModelOption => model !== null)
      : [];

    return { models: normalized };
  } catch {
    return { models: [] as AdminAiModelOption[] };
  }
}

/**
 * Normalize heterogeneous model payloads into the shape the admin UI expects.
 *
 * Why: Older or alternate backends may name fields differently (`id` vs
 * `modelId`, `name` vs `modelName`), so the UI canonicalizes them once here
 * instead of scattering compatibility logic across the form.
 */
function normalizeModelOption(raw: unknown, index: number): AdminAiModelOption | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const modelId =
    typeof record.modelId === 'string'
      ? record.modelId
      : typeof record.id === 'string'
        ? record.id
        : null;

  if (!modelId) {
    return null;
  }

  const provider = typeof record.provider === 'string' ? record.provider : inferProvider(modelId);
  const costTier =
    record.costTier === 'LOW' || record.costTier === 'MEDIUM' || record.costTier === 'HIGH'
      ? record.costTier
      : inferCostTier(modelId, String(record.modelName ?? modelId));

  return {
    id: typeof record.id === 'string' ? record.id : `${modelId}-${index}`,
    modelId,
    modelName:
      typeof record.modelName === 'string'
        ? record.modelName
        : typeof record.name === 'string'
          ? record.name
          : modelId,
    provider,
    summary: typeof record.summary === 'string' ? record.summary : null,
    costTier,
  };
}

function buildFallbackSummary(model: AdminAiModelOption) {
  const provider = model.provider ?? inferProvider(model.modelId);
  const costLabel = formatCostTier(model.costTier).toLowerCase();
  return `${model.modelName} is a ${provider} option suited for ${costLabel} usage with this admin policy.`;
}

function inferProvider(modelId: string) {
  const [provider] = modelId.split(':');
  return provider || 'provider';
}

/**
 * Approximate cost tiers for model-policy badges when the backend did not send one.
 *
 * Why: The labels are meant to guide admin choices, not encode vendor pricing,
 * so a small heuristic keeps the UI informative without depending on an exact
 * upstream contract.
 */
function inferCostTier(modelId: string, modelName: string): CostTier {
  const haystack = `${modelId} ${modelName}`.toLowerCase();
  if (haystack.includes('flash') || haystack.includes('mini') || haystack.includes('nano'))
    return 'LOW';
  if (haystack.includes('pro') || haystack.includes('4.1') || haystack.includes('ultra'))
    return 'HIGH';
  return 'MEDIUM';
}

function formatCostTier(costTier: CostTier | null | undefined) {
  if (costTier === 'LOW') return 'Low cost';
  if (costTier === 'HIGH') return 'Higher cost';
  return 'Balanced cost';
}

function costTierClassName(costTier: CostTier | null | undefined) {
  if (costTier === 'LOW') return 'tag tag-accent';
  if (costTier === 'HIGH') return 'tag tag-primary';
  return 'tag';
}

/**
 * Bound free-form numeric input to the backend's supported supervisor range.
 *
 * Why: Keeping the same 1-5 clamp in the form prevents admins from queuing a
 * save the service will reject and keeps the control aligned with policy rules.
 */
function clampIterations(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_POLICY.maxSupervisorIterations;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function InfoBadge({ copy }: { copy: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          aria-label="More information"
        >
          i
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        <p>{copy}</p>
      </TooltipContent>
    </Tooltip>
  );
}
