import { EduAiCoursePageSchema, EduAiTopicListSchema, EduAiEnrollmentListSchema, EduAiQuestionListSchema } from '../schemas/eduai.js';
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
 * Stateless AI completion endpoint (#858). Used by `aiGuidance.js` for tutor/supervisor
 * loops without course-chat persistence, RAG, or tool overhead.
 */
export function getEduAiCompletionUrl() {
  return `${getEduAiBaseUrl()}/completion`;
}

/**
 * @deprecated Use getEduAiCompletionUrl() for AI assist flows.
 */
/**
 * Core's list endpoints require paging (#1041) and cap `pageSize` at 200.
 * Requests that genuinely need a caller's whole visible set page-loop at this
 * size rather than asking for an unbounded list.
 */
export const CORE_PAGE_SIZE = 200;

/**
 * Safety stop for page-loops, so a bad `total` cannot spin forever. An
 * `all: true` read past this cap throws rather than returning a partial set.
 */
const CORE_MAX_PAGES = 50;

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
 * Pass `options.signal` (e.g. `AbortSignal.timeout(3000)`) to bound how long
 * a caller will wait — a Core that's up but slow/hung otherwise blocks the
 * socket with no timeout of its own.
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
    signal: options.signal,
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
 * Parse Core's paginated envelope into the course array these callers expect.
 * Core answers `{ data, total, page, pageSize }` on every list endpoint (#1041).
 */
function parseCoursePage(payload, context) {
  try {
    const parsed = EduAiCoursePageSchema.parse(payload);
    return parsed;
  } catch (e) {
    const err = new Error(`Invalid response when fetching EduAI courses (${context})`);
    err.cause = e;
    err.status = 502;
    throw err;
  }
}

/**
 * Read one page, or walk every page when the caller needs its whole visible set.
 *
 * `/courses` requires `page`/`pageSize`, so "give me everything" is no longer a
 * single request. Callers that only render a page pass `page`/`pageSize` and get
 * that page; import/sync flows that must reconcile against the caller's complete
 * set pass `all: true` and pay for the loop explicitly.
 */
async function fetchCoursePages(path, request, options = {}) {
  const pageSize = Math.min(options.pageSize ?? CORE_PAGE_SIZE, CORE_PAGE_SIZE);
  const search = options.search ? `&search=${encodeURIComponent(options.search)}` : '';

  const readPage = async (page) => {
    const payload = await requestEduAi(`${path}?page=${page}&pageSize=${pageSize}${search}`, request);
    return parseCoursePage(payload, `page ${page}`);
  };

  const first = await readPage(1 + (options.page ? options.page - 1 : 0));
  if (!options.all) return first.data;

  const courses = [...first.data];
  const pageCount = Math.ceil(first.total / pageSize) || 1;
  if (pageCount > CORE_MAX_PAGES) {
    // `all: true` promises the caller's complete set, so a truncated walk must
    // not be returned as if it were whole — the reconcile flows that use it
    // would read the missing tail as "deleted in Core". Every caller already
    // catches and degrades closed, so failing here is the safe direction.
    const error = new Error(
      `EduAI ${path} returned ${first.total} rows, past the ${CORE_MAX_PAGES}×${pageSize} page-walk cap; ` +
        'refusing to return a partial set for an all: true read.',
    );
    error.status = 502;
    throw error;
  }
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await readPage(page);
    courses.push(...next.data);
  }
  return courses;
}

/** Resolve a known set of course ids in one unpaged `?ids=` lookup (#1125). */
async function fetchCoursesByIds(path, request, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];

  const courses = [];
  // `ids` is capped server-side, so large id sets are chunked.
  for (let start = 0; start < unique.length; start += CORE_PAGE_SIZE) {
    const chunk = unique.slice(start, start + CORE_PAGE_SIZE);
    const payload = await requestEduAi(
      `${path}?ids=${encodeURIComponent(chunk.join(','))}`,
      request,
    );
    courses.push(...parseCoursePage(payload, 'ids lookup').data);
  }
  return courses;
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
 * GET a single Core admin bug report (full diagnostic blobs) (#979).
 */
export async function getCoreAdminBugReport(cookie, bugReportId) {
  if (!cookie) {
    const error = new Error('Session cookie is required to load a Core bug report');
    error.status = 401;
    throw error;
  }

  const url = `${getCoreBaseUrl()}/api/admin/bug-reports/${encodeURIComponent(bugReportId)}`;
  const response = await fetch(url, {
    headers: { cookie },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(errorText || `Core bug report GET failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * GET Core platform users (ADMIN session cookie). Identity is owned by Core.
 *
 * Core requires `page`/`pageSize` and answers with
 * `{ data, total, page, pageSize }` (#1041). Pass `ids` instead to resolve a
 * known set of users in one unpaged lookup (#1125) — that is what the id→name
 * maps in the admin routes use, since page-looping the whole table to build
 * them would be strictly worse.
 *
 * Returns the raw envelope so callers can read `total` without a second call.
 *
 * @param {{ signal?: AbortSignal }} options  Pass e.g. `AbortSignal.timeout(...)`
 *   so a hung Core can't hold this open past a caller's fallback (#1173 review).
 */
export async function listCoreAdminUsers(cookie, options = {}) {
  if (!cookie) {
    const error = new Error('Session cookie is required to list Core users');
    error.status = 401;
    throw error;
  }

  // Resolve a known id set (#1125). Core caps `ids` at CORE_PAGE_SIZE per
  // request, so dedupe and chunk — a course with more than CORE_PAGE_SIZE
  // enrolled users would otherwise exceed the cap and 400 with IDS_TOO_MANY,
  // losing the whole id->name map. Combine each chunk's envelope back into one.
  if (Array.isArray(options.ids)) {
    const unique = [...new Set(options.ids.filter(Boolean))];
    if (unique.length === 0) {
      return { data: [], total: 0, page: 1, pageSize: 0 };
    }
    const data = [];
    for (let start = 0; start < unique.length; start += CORE_PAGE_SIZE) {
      const chunk = unique.slice(start, start + CORE_PAGE_SIZE);
      const params = new URLSearchParams();
      params.set('ids', chunk.join(','));
      const envelope = await fetchCoreUsers(cookie, params, options.signal);
      data.push(...(envelope?.data ?? []));
    }
    return { data, total: data.length, page: 1, pageSize: data.length };
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('pageSize', String(options.pageSize ?? CORE_PAGE_SIZE));
  if (options.role) params.set('role', options.role);
  if (options.search) params.set('search', options.search);
  return fetchCoreUsers(cookie, params, options.signal);
}

/** Single `GET /api/users` request with the ADMIN session cookie. */
async function fetchCoreUsers(cookie, params, signal) {
  const url = `${getCoreBaseUrl()}/api/users?${params}`;
  const response = await fetch(url, {
    headers: { cookie },
    signal,
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
  return fetchCoursePages('/courses', { cookie }, options);
}

/**
 * Resolve one Core course by id through the `?ids=` lookup (#1125).
 *
 * This used to fetch the caller's entire course list and scan it. Under
 * required paging that would mean page-looping the list to find one row.
 */
export async function findEduAiCourseById(courseId, options = {}) {
  if (!courseId) return null;
  const cookie = typeof options.cookie === 'string' ? options.cookie : '';
  if (!cookie) {
    const error = new Error('Session cookie is required to fetch an EduAI course');
    error.status = 401;
    throw error;
  }
  const courses = await fetchCoursesByIds('/courses', { cookie }, [courseId]);
  return courses.find((course) => course.id === courseId) ?? null;
}

/**
 * Lists every Core course under the service key (#1082) — an UNSCOPED read of
 * the full non-deleted catalog (Core's `getCourses` service-key branch:
 * `prisma.course.findMany({ where: { deletedAt: null } })`), no enrollment/
 * publish/RBAC filtering and no `callerEnrollmentRole` (that field is
 * computed against the caller's own enrollments, which don't apply to a
 * service-key call).
 *
 * Use ONLY as a fallback for AT-enrolled courses missing from a caller's
 * cookie-scoped list (`listEduAiCourses`) — AT and Core enrollment are
 * intentionally independent tracks, so a miss there means "caller isn't
 * Core-scoped for it," not "doesn't exist." Never use this as the primary/
 * oracle source for a caller-facing list.
 */
export async function listEduAiCoursesServiceKey(options = {}) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const request = { headers: { Authorization: `Bearer ${serviceKey}` } };
  if (Array.isArray(options.ids)) {
    return fetchCoursesByIds('/courses', request, options.ids);
  }
  return fetchCoursePages('/courses', request, options);
}

export async function listEduAiCourseTopics(externalCourseId, options = {}) {
  if (!externalCourseId) return [];
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const data = await requestEduAi(`/courses/${externalCourseId}/topics`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
    signal: options.signal,
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

export async function listEduAiCourseEnrollmentsServiceKey(externalCourseId, options = {}) {
  if (!externalCourseId) return [];
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  const data = await requestEduAi(`/courses/${externalCourseId}/enrollments`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
    signal: options.signal,
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

  // #1041: `/ai-models` is paged and answers with `{ data, total, ... }`.
  const data = await requestEduAi(`/ai-models?page=1&pageSize=${CORE_PAGE_SIZE}`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  if (!Array.isArray(data?.data)) {
    throw new Error('Invalid response from EduAI models endpoint');
  }
  return data.data;
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

/** Removes an enrollment in Core, forwarding the acting user's session cookie. */
export async function deleteCoreEnrollment(externalCourseId, enrollmentId, cookie) {
  if (!cookie) {
    const error = new Error('Session cookie required to remove enrollment in Core');
    error.status = 401;
    throw error;
  }
  return requestEduAi(`/courses/${externalCourseId}/enrollments/${enrollmentId}`, {
    method: 'DELETE',
    cookie,
  });
}

/**
 * Fetches a single Core course by id using the service key.
 * Returns the course object on 200, null on 404 (soft-deleted or missing).
 * Throws on 5xx or network error so the caller can skip and retry next run.
 *
 * @param {number} coreOfferingId
 * @param {{ signal?: AbortSignal }} options  Pass e.g. `AbortSignal.timeout(...)` to bound the call
 */
export async function fetchCoreCourseSafe(coreOfferingId, options = {}) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  try {
    return await requestEduAi(`/courses/${coreOfferingId}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
      signal: options.signal,
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
 *
 * @param {number} coreOfferingId
 * @param {number} coreTopicId
 * @param {{ signal?: AbortSignal }} options  Pass e.g. `AbortSignal.timeout(...)` to bound the call
 */
export async function fetchCoreTopicSafe(coreOfferingId, coreTopicId, options = {}) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }
  try {
    return await requestEduAi(`/courses/${coreOfferingId}/topics/${coreTopicId}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
      signal: options.signal,
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
