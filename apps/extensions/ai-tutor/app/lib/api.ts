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

import type {
  AdminBugReportRow,
  AdminEnrollmentData,
  AdminAiModelPolicy,
  AdminUser,
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
  StudentMetricRow,
  SubmissionRow,
  SuggestedPrompt,
  User,
} from './types';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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

/**
 * Single fetch wrapper for the entire API surface. Every caller goes through
 * here so the cookie-credential semantics and the 401/403 redirect-to-Core-login
 * behavior remain consistent. Callers that must NOT trigger the redirect
 * (e.g. sign-out) should bypass this helper intentionally.
 */
async function http(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...headers,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiNetworkError();
  }

  if (!res.ok) {
    // 401 = unauthenticated → bounce to Core login so a session can be
    // established. 403 = authenticated but not authorized for THIS resource;
    // redirecting to login would just bounce an already-signed-in user
    // straight back here and loop forever (e.g. a UNIT_ADMIN deep-linking to a
    // lesson outside their unit). Surface 403 as a normal error instead so the
    // route's error boundary can render it.
    if (res.status === 401) {
      const coreUrl = import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
      window.location.href = `${coreUrl}/login?redirect=${encodeURIComponent(window.location.href)}`;
      throw new Error('Authentication required');
    }
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  me: () => http('/api/me') as Promise<{ user: User | null }>,
  aiStatus: () =>
    http('/api/ai-status') as Promise<{
      cloud: { state: 'online' | 'offline' | 'loading' | 'unknown'; detail?: string };
      ubc: { state: 'online' | 'offline' | 'loading' | 'unknown'; detail?: string };
    }>,
  listCourses: () => http('/api/courses'),
  courseById: (courseId: number) => http(`/api/courses/${courseId}`),
  updateCourse: (
    courseId: number,
    payload: {
      title?: string;
      description?: string | null;
      startDate?: string | null;
      endDate?: string | null;
    },
  ) =>
    http(`/api/courses/${courseId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
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
  modulesForCourse: (courseId: number) => http(`/api/courses/${courseId}/modules`),
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
  lessonsForModule: (moduleId: number) => http(`/api/modules/${moduleId}/lessons`),
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
  lessonById: (lessonId: number) => http(`/api/lessons/${lessonId}`),
  activitiesForLesson: (lessonId: number) => http(`/api/lessons/${lessonId}/activities`),
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
      mainTopicId: number;
      secondaryTopicIds?: number[];
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
      mainTopicId?: number;
      secondaryTopicIds?: number[];
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
  topicsForCourse: (courseId: number) => http(`/api/courses/${courseId}/topics`),
  createTopic: (courseId: number, payload: { name: string }) =>
    http(`/api/courses/${courseId}/topics`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  syncCourseTopics: (courseId: number) =>
    http(`/api/courses/${courseId}/topics/sync`, {
      method: 'POST',
    }),
  syncCourseEnrollments: (courseId: number) =>
    http(`/api/courses/${courseId}/sync-enrollments`, {
      method: 'POST',
    }) as Promise<{ synced: number; created: number; updated: number; deleted: number; errors: [] }>,
  remapCourseTopics: (courseId: number, mappings: { fromTopicId: number; toTopicId: number }[]) =>
    http(`/api/courses/${courseId}/topics/remap`, {
      method: 'POST',
      body: JSON.stringify({ mappings }),
    }),
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
  ) =>
    http(`/api/activities/${activityId}/teach`, {
      method: 'POST',
      body: JSON.stringify(params),
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
  ) =>
    http(`/api/activities/${activityId}/guide`, {
      method: 'POST',
      body: JSON.stringify(params),
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
  ) =>
    http(`/api/activities/${activityId}/custom`, {
      method: 'POST',
      body: JSON.stringify(params),
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
  listAdminUsers: () => http('/api/admin/users') as Promise<AdminUser[]>,
  listAdminCourses: () => http('/api/admin/courses') as Promise<Course[]>,
  getAdminCourseEnrollments: (courseId: number) =>
    http(`/api/admin/courses/${courseId}/enrollments`) as Promise<AdminEnrollmentData>,
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
