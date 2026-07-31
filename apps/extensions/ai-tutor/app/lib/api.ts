/**
 * @file Typed wire layer between the SPA and the Express API.
 *
 * Responsibility: Owns every HTTP call shape the frontend makes; centralizes
 *   cookie-session credentials, error normalization, and the cross-cutting
 *   redirect-on-auth-failure convention.
 * Callers: All route loaders, hooks, and components that need server data
 *   (e.g. `useLocalUser`, `useCourseTopics`, instructor/student route modules).
 * Gotchas:
 *   - Every request sets `credentials: 'include'` so Better Auth session
 *     cookies are attached. Do not switch to a bearer/JWT flow without
 *     updating the entire stack.
 *   - The shared `http()` helper turns a 401 into a hard redirect to Core's
 *     login page (`VITE_CORE_URL/login?redirect=<current-url>`). Route guards
 *     rely on this behavior. A 403 is surfaced as a thrown error (NOT a
 *     redirect) — the caller is already authenticated, so re-login would loop.
 *   - `logout` deliberately bypasses `http()` to avoid the redirect loop
 *     that would otherwise fire on the post-sign-out 401.
 *   - `updateActivity` accepts three legal `options` shapes for caller
 *     convenience and normalizes them to a flat `string[]` on the wire.
 * Related: `server/src/utils/mappers.js` — request/response shapes here MUST
 *   match the server mappers; silent breakage risk if they drift.
 */

import { toast } from 'sonner';
import type {
  AdminBugReportRow,
  AdminEnrollmentData,
  AdminAiModelPolicy,
  AdminUser,
  AdminUserPage,
  Activity,
  ActivityAnswerResult,
  ActivityAnalyticsRow,
  ActivityFeedbackRow,
  ActivityFeedbackResult,
  AiModel,
  BugReportCreatePayload,
  BugReportStatus,
  Course,
  EduAiApiKeyStatus,
  EnrollmentRole,
  Lesson,
  Module,
  StudentMetricRow,
  SubmissionRow,
  SuggestedPrompt,
  Topic,
  User,
} from './types';
import { getCoreLoginUrl } from './coreUrl';

/**
 * Set by course endpoints (#1072 step 2) when a request degraded gracefully
 * because EduAI Core couldn't be reached — the response still succeeds (200)
 * with locally-anchored, possibly-stale data instead of hard-erroring (mirrors
 * the #1066 topic fail-soft pattern). `http()` below surfaces it as a single
 * deduped toast (stable `id`, so concurrent course/stat calls during one page
 * load collapse into one notice instead of stacking).
 */
const CORE_STATUS_HEADER = 'X-Core-Status';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * The platform pagination envelope (#1043), matching the AI-Tutor server's
 * `paginated()` helper and EduAI Core's contract (#1041). Every list endpoint
 * that was previously a bare array now returns this shape.
 *
 * `total` is the full count matching the query (not the page length) — reader
 * code that used to rely on `array.length` for a total, drive "select all", or
 * derive a tree/ordinal from a complete list MUST read `total` and treat a
 * short `data` as a page, not the whole set.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Default page size for the structure-bounded "tree" endpoints (modules,
 * lessons, activities, topics). Their readers need the whole set (reorder,
 * ordinals, the lesson player), so they request one bounded page this large
 * rather than rendering a pager. See #1043 Group B. A course whose tree
 * exceeds this silently truncates — tracked as a follow-up.
 */
const TREE_PAGE_SIZE = 200;

/**
 * Default page size for course lists (#1043 Group A). The server now REQUIRES
 * page/pageSize, so callers that don't drive an explicit pager (dashboards,
 * the course switcher, the command palette, import-source dropdowns) send this
 * bounded page instead of an unbounded read. Views with a real pager pass their
 * own page/pageSize. A deployment with more courses than this in one of those
 * non-pager surfaces truncates — those surfaces are tracked for a follow-up
 * server-search UX (mirrors #1041's landed course-picker decision).
 */
export const COURSE_LIST_PAGE_SIZE = 200;

/**
 * Serialize pagination params into a query string. Returns '' when empty so
 * callers can append unconditionally.
 *
 * Callers must pass BOTH `page` and `pageSize` for endpoints that parse in
 * required mode — the server 400s (`PAGINATION_REQUIRED`) on a half-supplied
 * pair, so every call site below defaults `page: 1` alongside its page size.
 */
function pageQuery(params?: { page?: number; pageSize?: number }): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Hard ceiling for the session probe `/api/me`. If the AT API is up but its
 * upstream Core `/api/sessions/validate` hangs, a bare `/api/me` would never
 * settle — stranding loaders and leaving the "Initializing your workspace"
 * spinner running forever. Applied opt-in via `timeoutMs` on that call (below),
 * NOT globally: most of the API surface (imports, sync) may legitimately run
 * longer and hasn't been audited against a blanket cutoff.
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Local response shapes for endpoints not yet modeled in `./types`. Kept here
 * (rather than in the shared types file, which this module does not own)
 * until the canonical types land; fields are optional wherever the server
 * response shape isn't locked down yet, to avoid fabricating a contract.
 */
export interface GradedSubmission extends SubmissionRow {
  score?: number | null;
  feedback?: string | null;
}

export interface ImportableActivity {
  id: number;
  title?: string | null;
  question: string;
  type?: 'MCQ' | 'SHORT_TEXT';
  lessonId?: number;
  lessonTitle?: string | null;
  moduleTitle?: string | null;
  courseId?: number;
  courseTitle?: string | null;
}

export interface DashboardStats {
  enrolledCourses?: number;
  coursesInProgress?: number;
  coursesCompleted?: number;
  yourCourses?: number;
  publishedCourses?: number;
  draftCourses?: number;
  syncedCourses?: number;
  totalUsers?: number;
  totalCourses?: number;
  openBugReports?: number;
  totalBugReports?: number;
  pendingSubmissions?: number;
  [key: string]: unknown;
}

export interface AiTraceRow {
  id: number;
  mode?: string | null;
  knowledgeLevel?: string | null;
  tutorModelId?: string | null;
  supervisorModelId?: string | null;
  iterationCount?: number | null;
  finalOutcome?: string | null;
  createdAt?: string;
  user?: { id: string; name?: string | null } | null;
  activity?: { id: number; title?: string | null } | null;
  courseId?: number | null;
  courseTitle?: string | null;
}

/**
 * Thrown when the request never reached the server (e.g. connection refused
 * because the API is still booting on a fresh dev-stack start). Distinct from
 * an authenticated-but-rejected response so callers can retry instead of
 * treating it as "logged out".
 */
export class ApiNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

/** Thrown when a request is aborted by `http()`'s own timeout, not by a caller-supplied signal. */
export class ApiTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'ApiTimeoutError';
  }
}

// #999: the chat send path has no bound on how long a hung upstream call can
// leave the UI showing "Thinking...". This is the client-side half of that
// fix — the AI Tutor server also bounds its own EduAI round-trip
// (EDUAI_CALL_TIMEOUT_MS, default 45s) so this should normally see a clean
// 504 response (mapped to ApiTimeoutError below) before ever firing; it
// exists as a backstop. Opt-in via `timeoutMs` — deliberately NOT a global
// default, since most of the API surface (imports, sync operations, etc.)
// may legitimately take longer than a chat turn and hasn't been audited
// against a blanket cutoff.
export const CHAT_TIMEOUT_MS = 60_000;

/**
 * Single fetch wrapper for the entire API surface. Every caller goes through
 * here so the cookie-credential semantics and the 401/403 redirect-to-Core-login
 * behavior remain consistent. Callers that must NOT trigger the redirect
 * (e.g. sign-out) should bypass this helper intentionally.
 *
 * `init.signal`, if provided, lets the caller cancel the request directly
 * (e.g. a "Stop generating" button) — it's merged with the internal timeout
 * controller (when `init.timeoutMs` is also set) rather than passed straight
 * through, so both can independently abort the same underlying fetch.
 * Without `timeoutMs`, only `init.signal` (if provided) can abort — there is
 * no default timeout.
 */
async function http(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const { signal: callerSignal, timeoutMs, ...rest } = init ?? {};
  const controller = new AbortController();
  const TIMEOUT_REASON = Symbol('http-timeout');
  const timeoutId =
    timeoutMs != null ? setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs) : undefined;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...headers,
        ...init?.headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.reason === TIMEOUT_REASON) {
      throw new ApiTimeoutError();
    }
    if (controller.signal.aborted) {
      // Caller-initiated cancellation (e.g. Stop button) — rethrow as-is so
      // callers can distinguish it from a real failure via `error.name`.
      throw err;
    }
    throw new ApiNetworkError();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // 401 = unauthenticated → bounce to Core login so a session can be
    // established. 403 = authenticated but not authorized for THIS resource;
    // redirecting to login would just bounce an already-signed-in user
    // straight back here and loop forever (e.g. a UNIT_ADMIN deep-linking to a
    // lesson outside their unit). Surface 403 as a normal error instead so the
    // route's error boundary can render it.
    if (res.status === 401) {
      window.location.href = getCoreLoginUrl();
      throw new Error('Authentication required');
    }
    // 504 = the AI Tutor server's own upstream call timed out (see
    // EDUAI_CALL_TIMEOUT_MS in callEduAI()) — this is the common case in
    // practice, since the server's 45s bound fires well before this client's
    // own timeoutMs backstop. Map it to the same ApiTimeoutError callers
    // already handle for a client-side timeout, so "took too long" is shown
    // either way.
    if (res.status === 504) {
      throw new ApiTimeoutError();
    }
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  // Optional chaining: some lightweight test doubles for `Response` omit
  // `headers` entirely — a real `fetch` Response always has it.
  if (res.headers?.get?.(CORE_STATUS_HEADER) === 'unavailable') {
    toast.warning('EduAI Core is unavailable — course data may be out of date.', {
      id: 'core-unavailable',
    });
  }
  // 204 No Content (e.g. DELETE) has no body — `res.json()` would throw on the
  // empty payload, so short-circuit to null.
  if (res.status === 204) return null;
  return res.json();
}

/**
 * De-dupes concurrent `/api/me` calls. On a single navigation both the route
 * guard (`requireClientUser`) and the `AuthProvider` mount effect call
 * `api.me()` independently — without coalescing, that is two full round-trips
 * to Core's `/api/sessions/validate` per page. While a request is in flight,
 * additional callers share it; the slot clears as soon as it settles, so the
 * result is never cached across navigations (auth state stays fresh).
 */
let meInFlight: Promise<{ user: User | null }> | null = null;

export const api = {
  me: () => {
    if (meInFlight) return meInFlight;
    // #446: bound the session probe so a hung upstream can't strand the
    // "Initializing your workspace" spinner forever (surfaced as ApiTimeoutError).
    meInFlight = (http('/api/me', { timeoutMs: REQUEST_TIMEOUT_MS }) as Promise<{ user: User | null }>).finally(() => {
      meInFlight = null;
    });
    return meInFlight;
  },
  aiStatus: () =>
    http('/api/ai-status') as Promise<{
      cloud: { state: 'online' | 'offline' | 'loading' | 'unknown'; detail?: string };
      ubc: { state: 'online' | 'offline' | 'loading' | 'unknown'; detail?: string };
    }>,
  listCourses: (params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/courses${pageQuery({ page: 1, pageSize: COURSE_LIST_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Course>>,
  courseById: (courseId: number) => http(`/api/courses/${courseId}`),
  publishCourse: (courseId: number) =>
    http(`/api/courses/${courseId}/publish`, {
      method: 'PATCH',
    }),
  unpublishCourse: (courseId: number) =>
    http(`/api/courses/${courseId}/unpublish`, {
      method: 'PATCH',
    }),
  importIntoCourse: (
    courseId: number,
    payload: {
      sourceCourseId?: number;
      moduleIds?: number[];
      lessonIds?: number[];
      targetModuleId?: number;
    },
  ) =>
    http(`/api/courses/${courseId}/import`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  modulesForCourse: (courseId: number, params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/courses/${courseId}/modules${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Module>>,
  moduleById: (moduleId: number) => http(`/api/modules/${moduleId}`),
  createModule: (
    courseId: number,
    payload: { title: string; description?: string; position?: number },
  ) =>
    http(`/api/courses/${courseId}/modules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  publishModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}/publish`, {
      method: 'PATCH',
    }),
  unpublishModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}/unpublish`, {
      method: 'PATCH',
    }),
  updateModule: (
    moduleId: number,
    payload: { title?: string; description?: string | null; position?: number },
  ) =>
    http(`/api/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}`, {
      method: 'DELETE',
    }),
  // Bulk-reorder every module in a course. `orderedIds` is the full ordered
  // set of module ids; the server reassigns positions 0..n-1 atomically.
  reorderModules: (courseId: number, orderedIds: number[]) =>
    http(`/api/courses/${courseId}/modules/order`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
  lessonsForModule: (moduleId: number, params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/modules/${moduleId}/lessons${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Lesson>>,
  createLesson: (
    moduleId: number,
    payload: { title: string; contentMd?: string; position?: number },
  ) =>
    http(`/api/modules/${moduleId}/lessons`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  publishLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}/publish`, {
      method: 'PATCH',
    }),
  unpublishLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}/unpublish`, {
      method: 'PATCH',
    }),
  updateLesson: (
    lessonId: number,
    payload: { title?: string; contentMd?: string | null; position?: number },
  ) =>
    http(`/api/lessons/${lessonId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}`, {
      method: 'DELETE',
    }),
  // Bulk-reorder every lesson within a module (see reorderModules).
  reorderLessons: (moduleId: number, orderedIds: number[]) =>
    http(`/api/modules/${moduleId}/lessons/order`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
  lessonById: (lessonId: number) => http(`/api/lessons/${lessonId}`),
  activitiesForLesson: (lessonId: number, params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/lessons/${lessonId}/activities${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Activity>>,
  createActivity: (
    lessonId: number,
    payload: {
      title?: string;
      question: string;
      type?: 'MCQ' | 'SHORT_TEXT';
      options?: { choices?: string[] } | null;
      answer?: any;
      hints?: string[];
      instructionsMd?: string;
      promptTemplateId?: number | null;
      customPrompt?: string | null;
      customPromptTitle?: string | null;
      mainTopicId: string | number;
      secondaryTopicIds?: (string | number)[];
      enableTeachMode?: boolean;
      enableGuideMode?: boolean;
      enableCustomMode?: boolean;
    },
  ) =>
    http(`/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateActivity: (
    activityId: number,
    payload: {
      title?: string | null;
      instructionsMd?: string;
      question?: string;
      type?: 'MCQ' | 'SHORT_TEXT';
      options?: { choices?: string[] } | string[] | null;
      answer?: any;
      hints?: string[];
      promptTemplateId?: number | null;
      customPrompt?: string | null;
      customPromptTitle?: string | null;
      mainTopicId?: string | number;
      secondaryTopicIds?: (string | number)[];
      enableTeachMode?: boolean;
      enableGuideMode?: boolean;
      enableCustomMode?: boolean;
    },
  ) => {
    const body: Record<string, unknown> = { ...payload };
    if (Object.prototype.hasOwnProperty.call(payload, 'options')) {
      const value = payload.options;
      if (value === null) {
        body.options = null;
      } else if (Array.isArray(value)) {
        body.options = value;
      } else if (value && Array.isArray(value.choices)) {
        body.options = value.choices;
      }
    }
    return http(`/api/activities/${activityId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteActivity: (activityId: number) =>
    http(`/api/activities/${activityId}`, {
      method: 'DELETE',
    }),
  // Bulk-reorder every activity within a lesson (see reorderModules).
  reorderActivities: (lessonId: number, orderedIds: number[]) =>
    http(`/api/lessons/${lessonId}/activities/order`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
  topicsForCourse: (courseId: number, params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/courses/${courseId}/topics${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Topic>>,
  createTopic: (courseId: number, payload: { name: string }) =>
    http(`/api/courses/${courseId}/topics`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  syncCourseEnrollments: (courseId: number) =>
    http(`/api/courses/${courseId}/sync-enrollments`, {
      method: 'POST',
    }) as Promise<{ synced: number; created: number; updated: number; deleted: number; errors: [] }>,
  submitAnswer: (activityId: number, payload: any) =>
    http(`/api/questions/${activityId}/answer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<ActivityAnswerResult>,
  submitActivityFeedback: (activityId: number, payload: { rating: number; note?: string }) =>
    http(`/api/activities/${activityId}/feedback`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<ActivityFeedbackResult>,
  sendTeachMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      topicId?: number;
      message: string;
      modelId: string;
      apiKey: string;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/teach`, {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  sendGuideMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      message: string;
      studentAnswer?: string | number | null;
      modelId: string;
      apiKey: string;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/guide`, {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  sendCustomMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      topicId?: number;
      message: string;
      studentAnswer?: string | number | null;
      modelId: string;
      apiKey: string;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/custom`, {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  listChatSessions: (activityId: number) =>
    http(`/api/activities/${activityId}/chat-sessions`) as Promise<
      Array<{ id: number; chatId: string; mode: string; modelId: string | null; createdAt: string; updatedAt: string }>
    >,
  getChatMessages: (activityId: number, chatId: string) =>
    http(`/api/activities/${activityId}/chat-sessions/${chatId}/messages`) as Promise<{
      chat: { id: string; title: string | null };
      messages: Array<{ messageId: string; role: string; content: unknown }>;
    }>,
  listAiModels: () => http('/api/ai-models') as Promise<AiModel[]>,
  validateApiKey: (provider: string, apiKey: string) =>
    http('/api/ai-models/validate-key', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    }) as Promise<{ valid: boolean; error?: string }>,
  getEduAiApiKeyStatus: () =>
    http('/api/admin/settings/eduai-api-key') as Promise<EduAiApiKeyStatus>,
  getAdminAiModelPolicy: async () => {
    const result = await http('/api/admin/settings/ai-model-policy');
    return (result?.policy ?? result) as AdminAiModelPolicy;
  },
  setAdminAiModelPolicy: async (payload: AdminAiModelPolicy) => {
    const result = await http('/api/admin/settings/ai-model-policy', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return (result?.policy ?? result) as AdminAiModelPolicy;
  },
  /**
   * Paged platform users from Core (#1041). Returns the envelope, not an array —
   * `stats` carries the platform-wide totals the dashboard needs.
   */
  listAdminUsers: (params: { page?: number; pageSize?: number } = {}) =>
    http(
      `/api/admin/users?page=${params.page ?? 1}&pageSize=${params.pageSize ?? 25}`,
    ) as Promise<AdminUserPage>,
  listAdminCourses: (params?: { page?: number; pageSize?: number }) =>
    http(
      `/api/admin/courses${pageQuery({ page: 1, pageSize: COURSE_LIST_PAGE_SIZE, ...params })}`,
    ) as Promise<Paginated<Course>>,
  /**
   * `availableStudents` is one page of Core's STUDENT list (#1041) — pass
   * `search`/`page` to reach students past the first page.
   */
  getAdminCourseEnrollments: (
    courseId: number,
    params: { search?: string; page?: number; pageSize?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const suffix = query.size > 0 ? `?${query}` : '';
    return http(
      `/api/admin/courses/${courseId}/enrollments${suffix}`,
    ) as Promise<AdminEnrollmentData>;
  },
  removeStudentFromCourse: (courseId: number, userId: string) =>
    http(`/api/admin/courses/${courseId}/enrollments/${userId}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
  updateEnrollmentRole: (courseId: number, userId: string, role: EnrollmentRole) =>
    http(`/api/admin/courses/${courseId}/enrollments/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }) as Promise<{ ok: true; role: EnrollmentRole }>,
  courseSubmissions: (
    courseId: number,
    params?: { activityId?: number; studentId?: string; take?: number; skip?: number },
  ) => {
    const search = new URLSearchParams();
    if (params?.activityId != null) search.set('activityId', String(params.activityId));
    if (params?.studentId) search.set('studentId', params.studentId);
    if (params?.take != null) search.set('take', String(params.take));
    if (params?.skip != null) search.set('skip', String(params.skip));
    const qs = search.toString();
    return http(`/api/courses/${courseId}/submissions${qs ? `?${qs}` : ''}`) as Promise<
      SubmissionRow[]
    >;
  },
  listCourseFeedback: (
    courseId: number,
    params?: { activityId?: number; studentId?: string; take?: number; skip?: number },
  ) => {
    const search = new URLSearchParams();
    if (params?.activityId != null) search.set('activityId', String(params.activityId));
    if (params?.studentId) search.set('studentId', params.studentId);
    if (params?.take != null) search.set('take', String(params.take));
    if (params?.skip != null) search.set('skip', String(params.skip));
    const qs = search.toString();
    return http(`/api/courses/${courseId}/feedback${qs ? `?${qs}` : ''}`) as Promise<
      ActivityFeedbackRow[]
    >;
  },
  courseStudentMetrics: (courseId: number) =>
    http(`/api/courses/${courseId}/student-metrics`) as Promise<StudentMetricRow[]>,
  courseAnalytics: (courseId: number) =>
    http(`/api/courses/${courseId}/analytics`) as Promise<ActivityAnalyticsRow[]>,
  activitySubmissions: (activityId: number) =>
    http(`/api/activities/${activityId}/submissions`) as Promise<SubmissionRow[]>,
  listActivityFeedback: (activityId: number) =>
    http(`/api/activities/${activityId}/feedback`) as Promise<ActivityFeedbackRow[]>,
  mySubmissions: () => http('/api/me/submissions') as Promise<SubmissionRow[]>,
  myFeedback: () => http('/api/me/feedback') as Promise<ActivityFeedbackRow[]>,
  submitBugReport: (payload: BugReportCreatePayload) =>
    http('/api/bug-reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<{ id: string; status: BugReportStatus; createdAt: string }>,
  listAdminBugReports: () => http('/api/admin/bug-reports') as Promise<AdminBugReportRow[]>,
  getAdminBugReport: (reportId: string) =>
    http(`/api/admin/bug-reports/${reportId}`) as Promise<AdminBugReportRow>,
  updateAdminBugReportStatus: (reportId: string, payload: { status: BugReportStatus }) =>
    http(`/api/admin/bug-reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }) as Promise<AdminBugReportRow>,
  setEduAiApiKey: (apiKey: string) =>
    http('/api/admin/settings/eduai-api-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }) as Promise<EduAiApiKeyStatus>,
  clearEduAiApiKey: () =>
    http('/api/admin/settings/eduai-api-key', {
      method: 'DELETE',
    }) as Promise<EduAiApiKeyStatus>,
  listPrompts: () => http('/api/prompts'),
  listSuggestedPrompts: () => http('/api/suggested-prompts') as Promise<SuggestedPrompt[]>,
  createPrompt: (payload: {
    name: string;
    systemPrompt: string;
    temperature?: number | null;
    topP?: number | null;
  }) =>
    http('/api/prompts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  gradeSubmission: (
    activityId: number,
    submissionId: number,
    body: { score?: number; isCorrect?: boolean },
  ) =>
    http(`/api/activities/${activityId}/submissions/${submissionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<GradedSubmission>,
  duplicateActivity: (activityId: number) =>
    http(`/api/activities/${activityId}/duplicate`, {
      method: 'POST',
    }) as Promise<Activity>,
  importActivity: (lessonId: number, sourceActivityId: number) =>
    http(`/api/lessons/${lessonId}/activities/import`, {
      method: 'POST',
      body: JSON.stringify({ sourceActivityId }),
    }) as Promise<Activity>,
  listImportableActivities: (
    courseId?: number,
    params?: { excludeLessonId?: number; page?: number; pageSize?: number },
  ) => {
    const search = new URLSearchParams();
    if (courseId != null) search.set('courseId', String(courseId));
    if (params?.excludeLessonId != null) {
      search.set('excludeLessonId', String(params.excludeLessonId));
    }
    // Group A endpoint — server requires page/pageSize; the picker takes one
    // bounded page (server-side excludeLessonId keeps it from emptying).
    search.set('page', String(params?.page ?? 1));
    search.set('pageSize', String(params?.pageSize ?? COURSE_LIST_PAGE_SIZE));
    return http(`/api/activities/importable?${search.toString()}`) as Promise<
      Paginated<ImportableActivity>
    >;
  },
  dashboardStats: () => http('/api/me/dashboard-stats') as Promise<DashboardStats>,
  adminAiTraces: (params?: { unit?: string; courseId?: string | number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.unit) search.set('unit', params.unit);
    if (params?.courseId != null) search.set('courseId', String(params.courseId));
    if (params?.limit != null) search.set('limit', String(params.limit));
    const qs = search.toString();
    return http(`/api/admin/ai-traces${qs ? `?${qs}` : ''}`) as Promise<AiTraceRow[]>;
  },
  /**
   * Proxies sign-out through the AT backend (server-to-server to Core) so the
   * browser avoids CORS restrictions on Core's sign-out endpoint.
   * Bypasses `http()` to avoid the 401-redirect loop that would fire if the
   * session is already stale by the time logout is called.
   */
  logout: async () => {
    await fetch(`${API_BASE}/api/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    return { ok: true } as const;
  },
};

export default api;
