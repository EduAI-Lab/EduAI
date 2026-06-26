import { EduAiCourseListSchema, EduAiTopicListSchema, EduAiEnrollmentListSchema, EduAiQuestionListSchema } from '../schemas/eduai.js';
import { getEffectiveEduAiApiKey } from './systemSettings.js';
const DEFAULT_BASE_URL = 'http://localhost:5174/api';

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl) return DEFAULT_BASE_URL;
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

export function getEduAiBaseUrl() {
  return normalizeBaseUrl(process.env.EDUAI_BASE_URL || DEFAULT_BASE_URL);
}

/**
 * AI completion endpoint. Used by `aiGuidance.js` rather than the
 * `requestEduAi` helper because chat needs custom headers and a non-trivial body shape.
 */
export function getEduAiChatUrl() {
  return `${getEduAiBaseUrl()}/chat`;
}

/**
 * Shared fetch helper. Surfaces upstream HTTP failures as Errors with
 * `status` set so route handlers can pass them through unchanged. Returns
 * `null` on 204 No Content; otherwise parses JSON.
 *
 * Pass `options.cookie` (the raw Cookie header forwarded from the request)
 * for user-scoped calls. Omit for unauthenticated endpoints.
 */
async function requestEduAi(path, options = {}) {
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';

  const url = `${getEduAiBaseUrl()}${path}`;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText || `EduAI request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * POST a bug report to Core on behalf of the given Core user CUID.
 * Returns null on success (Core responds 201 no body).
 * Throws an Error with `status` set on HTTP failure.
 */
export async function postCoreBugReport(userId, payload) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }

  const url = `${process.env.CORE_URL || 'http://localhost:3000'}/api/bug-reports`;
  const body = {
    source: 'AI_TUTOR',
    userId,
    description: payload.description,
    isAnonymous: payload.isAnonymous ?? false,
    consoleLogs: payload.consoleLogs ?? null,
    networkLogs: payload.networkLogs ?? null,
    screenshot: payload.screenshot ?? null,
    pageUrl: payload.pageUrl ?? null,
    userAgent: payload.userAgent ?? null,
    context: payload.context ?? null,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || `Core bug report POST failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return null;
}

function getCoreBaseUrl() {
  const raw = process.env.CORE_URL || 'http://localhost:3000';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * GET Core admin bug reports (ADMIN session cookie). Used for AI Tutor-scoped triage (#648).
 */
export async function listCoreAdminBugReports(cookie, { source = 'AI_TUTOR', limit = 100, offset = 0 } = {}) {
  if (!cookie) {
    const error = new Error('Session cookie is required to list Core bug reports');
    error.status = 401;
    throw error;
  }

  const params = new URLSearchParams({
    source,
    limit: String(limit),
    offset: String(offset),
  });
  const url = `${getCoreBaseUrl()}/api/admin/bug-reports?${params}`;
  const response = await fetch(url, {
    headers: { cookie },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || `Core bug report list failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * GET Core platform users (ADMIN session cookie). Identity is owned by Core.
 */
export async function listCoreAdminUsers(cookie) {
  if (!cookie) {
    const error = new Error('Session cookie is required to list Core users');
    error.status = 401;
    throw error;
  }

  const url = `${getCoreBaseUrl()}/api/users`;
  const response = await fetch(url, {
    headers: { cookie },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || `Core user list failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * PATCH Core admin bug report status (ADMIN session cookie).
 */
export async function patchCoreAdminBugReportStatus(cookie, bugReportId, coreStatus) {
  if (!cookie) {
    const error = new Error('Session cookie is required to update Core bug reports');
    error.status = 401;
    throw error;
  }

  const url = `${getCoreBaseUrl()}/api/admin/bug-reports/${bugReportId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({ status: coreStatus }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || `Core bug report PATCH failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

 
/**
 * Propagate a publish/unpublish action to Core for a linked course offering.
 * Called by the AI Tutor publish/unpublish routes when `coreOfferingId` is set.
 * Uses the service key — Core verifies the key and applies the change.
 * Throws an Error with `status` set on HTTP failure.
 */
export async function setCoreCoursePublishState(coreOfferingId, publish) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const action = publish ? 'publish' : 'unpublish';
  return requestEduAi(`/courses/${coreOfferingId}/${action}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
}
 
/**   
 * Lists Core courses visible to the caller (#578). Requires the user's Core
 * session cookie — do not use the service key (that returns the full catalog).
 */
export async function listEduAiCourses(options = {}) {
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';
  if (!cookie) {
    const error = new Error('Session cookie is required to list EduAI courses');
    error.status = 401;
    throw error;
  }
  const data = await requestEduAi('/courses', { cookie });
  try {
    const parsed = EduAiCourseListSchema.parse(data);
    return parsed.courses;
  } catch (e) {
    const err = new Error('Invalid response when fetching EduAI courses');
    err.cause = e;
    err.status = 502;
    throw err;
  }
}

export async function findEduAiCourseById(courseId, options = {}) {
  if (!courseId) return null;
  const courses = await listEduAiCourses(options);
  return courses.find((course) => course.id === courseId) ?? null;
}

export async function listEduAiCourseTopics(externalCourseId) {
  if (!externalCourseId) return [];
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const data = await requestEduAi(`/courses/${externalCourseId}/topics`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  try {
    const parsed = EduAiTopicListSchema.parse(data);
    return parsed.topics;
  } catch (e) {
    const err = new Error('Invalid response when fetching EduAI course topics');
    err.cause = e;
    err.status = 502;
    throw err;
  }
}

export async function listEduAiCourseEnrollmentsServiceKey(externalCourseId) {
  if (!externalCourseId) return [];
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const data = await requestEduAi(`/courses/${externalCourseId}/enrollments`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  try {
    const parsed = EduAiEnrollmentListSchema.parse(data);
    return parsed.enrollments;
  } catch (e) {
    const err = new Error('Invalid response when fetching EduAI course enrollments');
    err.cause = e;
    err.status = 502;
    throw err;
  }
}

export async function listEduAiModels() {
  const serviceKey = await getEffectiveEduAiApiKey();
  if (!serviceKey) {
    const error = new Error('EDUAI_API_KEY not configured');
    error.status = 503;
    throw error;
  }

  const data = await requestEduAi('/ai-models', {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  if (!Array.isArray(data)) {
    throw new Error('Invalid response from EduAI models endpoint');
  }
  return data;
}

/**
 * Update an enrollment's role in Core, forwarding the acting user's session cookie.
 * Core's enrollment-role endpoint requires user session auth (not service key).
 * Throws an Error with `status` set on HTTP failure.
 */
export async function patchCoreEnrollmentRole(externalCourseId, enrollmentId, role, cookie) {
  if (!cookie) {
    const error = new Error('Session cookie required to update enrollment role in Core');
    error.status = 401;
    throw error;
  }
  return requestEduAi(`/courses/${externalCourseId}/enrollments/${enrollmentId}`, {
    method: 'PATCH',
    cookie,
    body: { role },
  });
}

/**
 * Fetches a single Core course by id using the service key.
 * Returns the course object on 200, null on 404 (soft-deleted or missing).
 * Throws on 5xx or network error so the caller can skip and retry next run.
 */
export async function fetchCoreCourseSafe(coreOfferingId) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  try {
    return await requestEduAi(`/courses/${coreOfferingId}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetches a single Core topic by id using the service key.
 * Returns the topic object on 200, null on 404 (soft-deleted or missing).
 * Throws on 5xx or network error so the caller can skip and retry next run.
 */
export async function fetchCoreTopicSafe(coreOfferingId, coreTopicId) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  try {
    return await requestEduAi(`/courses/${coreOfferingId}/topics/${coreTopicId}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch testable questions for a Core course offering using the service key.
 * Returns the `questions` array from Core's paginated response.
 * Throws an Error with `status` set on HTTP failure.
 */
export async function listCourseTestableQuestions(coreOfferingId, { limit = 20, offset = 0 } = {}) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }

  const params = new URLSearchParams({
    courseId: coreOfferingId,
    testable: 'true',
    limit: String(limit),
    offset: String(offset),
  });

  const data = await requestEduAi(`/questions?${params}`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });

  try {
    const parsed = EduAiQuestionListSchema.parse(data);
    return parsed.questions;
  } catch (e) {
    const err = new Error('Invalid response when fetching Core testable questions');
    err.cause = e;
    err.status = 502;
    throw err;
  }
}
