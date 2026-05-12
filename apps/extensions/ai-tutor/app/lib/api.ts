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
 *   - The shared `http()` helper turns ANY 401/403 (when not already at `/`)
 *     into a hard `window.location.href = '/'` redirect. This is the
 *     codebase-wide auth-failure convention; route guards rely on it.
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
  ActivityFeedbackResult,
  AiModel,
  BugReportCreatePayload,
  BugReportStatus,
  Course,
  EduAiApiKeyStatus,
  EduAiCourse,
  SuggestedPrompt,
  User,
} from './types';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * Single fetch wrapper for the entire API surface. Every caller goes through
 * here so the cookie-credential semantics and the 401/403 redirect-to-root
 * behavior remain consistent. Callers that must NOT trigger the redirect
 * (e.g. sign-out) should bypass this helper intentionally.
 */
async function http(path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...headers,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // Only redirect if we are NOT already at the root
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
      throw new Error('Authentication required');
    }
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  me: () => http('/api/me') as Promise<{ user: User | null }>,
  listCourses: () => http('/api/courses'),
  listEduAiCourses: () => http('/api/eduai/courses') as Promise<EduAiCourse[]>,
  courseById: (courseId: number) => http(`/api/courses/${courseId}`),
  createCourse: (payload: {
    title: string;
    description?: string;
    sourceCourseId?: number;
    startDate?: string;
    endDate?: string;
  }) =>
    http('/api/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
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
  importEduAiCourse: (payload: { externalCourseId: string }) =>
    http('/api/courses/import-external', {
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
  enrollStudentInCourse: (courseId: number, userId: string) =>
    http(`/api/admin/courses/${courseId}/enrollments`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }) as Promise<{ ok: true }>,
  removeStudentFromCourse: (courseId: number, userId: string) =>
    http(`/api/admin/courses/${courseId}/enrollments/${userId}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
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
   * Bypasses `http()` on purpose: sign-out responses can be 401-ish in some
   * race conditions, and routing the call through `http()` would trigger the
   * redirect-to-`/` convention before the caller can clean up local state.
   * We also do not care about the body — best-effort POST is sufficient.
   */
  logout: async () => {
    await fetch(`${API_BASE}/api/auth/sign-out`, {
      method: 'POST',
      credentials: 'include',
    });
    return { ok: true } as const;
  },
};

export default api;
