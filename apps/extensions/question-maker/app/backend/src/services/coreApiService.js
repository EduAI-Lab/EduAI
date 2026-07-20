/**
 * Thin HTTP client for QM → Core API calls.
 * Each function maps to one Core endpoint and throws on non-success responses
 * (status stored on the error as .status, parsed body as .body).
 */
import { config } from '../config/settings.js';

function serviceHeaders({ cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.eduaiApiKey) {
    headers.Authorization = `Bearer ${config.eduaiApiKey}`;
  } else if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

function authHeaderVariants({ cookie, preferCookie = false } = {}) {
  const variants = [];
  const service = config.eduaiApiKey ? { Authorization: `Bearer ${config.eduaiApiKey}` } : null;
  const session = cookie ? { cookie } : null;

  if (preferCookie) {
    if (session) variants.push(session);
    if (service) variants.push(service);
  } else {
    if (service) variants.push(service);
    if (session) variants.push(session);
  }

  return variants;
}

function isRetryableAuthFailure(status, body) {
  return (
    (status === 401 || status === 403) &&
    (body?.error === 'INVALID_SERVICE_KEY' ||
      body?.error === 'Unauthorized' ||
      body?.error === 'Forbidden')
  );
}

/**
 * Calls Core with service-key and/or session-cookie auth.
 * When both are available, retries with the alternate auth mode on auth failures
 * so a stale EDUAI_API_KEY does not block user-session reads — unless `cookieOnly`
 * is set (user-scoped reads must not fall back to the unscoped service key).
 */
async function fetchFromCore(
  path,
  { method = 'GET', body, cookie, preferCookie = false, cookieOnly = false } = {},
) {
  const url = `${config.coreUrl}${path}`;
  let variants = authHeaderVariants({ cookie, preferCookie });
  if (cookieOnly) {
    variants = cookie ? [{ cookie }] : [];
  }

  if (variants.length === 0) {
    throw coreError('EDUAI_API_KEY not configured and no session cookie available', 503, {
      error: 'CORE_SERVICE_UNAVAILABLE',
    });
  }

  let lastError;
  for (const authHeaders of variants) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();

    const errBody = await res.json().catch(() => ({}));
    const err = coreError(errBody.error || 'Core request failed', res.status, errBody);
    if (variants.length > 1 && isRetryableAuthFailure(res.status, errBody)) {
      lastError = err;
      continue;
    }
    throw err;
  }

  throw lastError;
}

function coreError(message, status, body) {
  return Object.assign(new Error(message), { status, body });
}

/** GET /api/courses/:courseId/topics — returns { topics: [{ id, name }] } (deleted topics excluded by Core) */
export async function getCourseTopicsFromCore(coreCourseId, opts = {}) {
  const cookie = opts.cookie ?? '';
  return fetchFromCore(`/api/courses/${coreCourseId}/topics`, {
    cookie,
    preferCookie: Boolean(cookie),
    cookieOnly: Boolean(cookie),
  });
}

/**
 * POST /api/courses/:courseId/topics — creates a topic on Core.
 * On 409 TOPIC_ALREADY_EXISTS, returns { id: existingId } instead of throwing.
 */
export async function pushTopicToCore(coreCourseId, name) {
  const res = await fetch(`${config.coreUrl}/api/courses/${coreCourseId}/topics`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    if (!body.existingId) {
      throw coreError('Topic exists in Core but has been deleted; restore it there before syncing', 409, body);
    }
    return { id: body.existingId };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core topic push failed', res.status, body);
  }
  const data = await res.json();
  return { id: data.id };
}

/**
 * POST /api/questions — session-only endpoint on Core.
 * Forwards the caller's session cookie so Core can authenticate the user
 * and derive createdBy from the session.
 */
export async function pushQuestionToCore(payload, cookieHeader) {
  const res = await fetch(`${config.coreUrl}/api/questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: cookieHeader ?? '',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core question push failed', res.status, body);
  }
  return res.json();
}

/**
 * PATCH /api/questions/:id — toggles testable on Core.
 * Returns null on 404 QUESTION_NOT_FOUND so callers can null their core_question_id.
 */
export async function patchQuestionTestableOnCore(coreQuestionId, testable) {
  const res = await fetch(`${config.coreUrl}/api/questions/${coreQuestionId}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ testable }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core question patch failed', res.status, body);
  }
  return res.json();
}

/**
 * GET /api/courses/:id/enrollments via the service key — returns the full
 * enrollment list ({ enrollments: [{ studentId, role, isActive, ... }] })
 * unscoped, so QM can apply its own access logic (mirroring Core's keystone).
 * Returns { enrollments: [] } when the course no longer exists in Core (404).
 */
export async function getCourseEnrollmentsFromCore(coreCourseId, opts = {}) {
  // Unscoped roster read for QM RBAC — service key when configured; never prefer cookie
  // (students receive 403 on the session path).
  return fetchFromCore(`/api/courses/${coreCourseId}/enrollments`, {
    cookie: opts.cookie,
    preferCookie: false,
  }).catch((err) => {
    if (err.status === 404) return { enrollments: [] };
    throw err;
  });
}

/**
 * GET /api/courses/:id — returns the Core course row (including `department`,
 * needed for the UNIT_ADMIN unit lock).
 * Returns null when the course no longer exists in Core (404).
 *
 * `preferCookie` defaults to the caller's cookie presence (session-first, same
 * as always) — pass `preferCookie: false` explicitly for pure FIELD reads that
 * don't need the caller's identity (e.g. read-through enrichment): those should
 * try the unscoped service key first so a caller-RBAC mismatch on Core's session
 * branch (a 403 whose body doesn't match `isRetryableAuthFailure`) can't degrade
 * a resolvable course to a placeholder (#1072 unified contract).
 */
export async function getCourseFromCore(coreCourseId, opts = {}) {
  try {
    return await fetchFromCore(`/api/courses/${coreCourseId}`, {
      cookie: opts.cookie,
      preferCookie: opts.preferCookie ?? Boolean(opts.cookie),
    });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * GET /api/courses — session-scoped course list for instructor UI flows (#578).
 * Forwards the caller's Core session cookie so Core applies `buildCourseListFilter`
 * (INSTRUCTOR/TA enrollments, etc.). Do not use the service key for course pickers.
 */
export async function listCoursesFromCore(cookieHeader) {
  return fetchFromCore('/api/courses', {
    cookie: cookieHeader,
    preferCookie: true,
    cookieOnly: true,
  });
}

/** Returns true when `coreCourseId` appears in the caller's scoped Core course list (#578). */
export async function isCoreCourseInScopedList(coreCourseId, cookieHeader) {
  const data = await listCoursesFromCore(cookieHeader);
  const courses = Array.isArray(data?.courses) ? data.courses : [];
  return courses.some((course) => course?.id === coreCourseId);
}

/**
 * GET /api/courses/:courseId/topics/:topicId via the service key.
 * Returns the topic object on 200, null on 404 (soft-deleted or missing).
 * Throws on 5xx or network error so the caller can skip and retry next run.
 */
export async function getTopicByIdFromCore(coreCourseId, coreTopicId) {
  try {
    return await fetchFromCore(`/api/courses/${coreCourseId}/topics/${coreTopicId}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * GET /api/questions/:id via the service key.
 * Returns the question object on 200, null on 404 (soft-deleted or missing).
 * Throws on 5xx or network error so the caller can skip and retry next run.
 */
export async function getQuestionByIdFromCore(coreQuestionId) {
  try {
    return await fetchFromCore(`/api/questions/${coreQuestionId}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * GET /api/me — own-profile read for the calling user. This endpoint is
 * session-only (no service-key path), so the caller's cookie must be forwarded;
 * it is the only source of `authorizedUnits` for a UNIT_ADMIN caller.
 */
export async function getMyProfileFromCore(cookieHeader) {
  const res = await fetch(`${config.coreUrl}/api/me`, {
    headers: { cookie: cookieHeader ?? '' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core profile fetch failed', res.status, body);
  }
  return res.json();
}

/** GET /api/courses via service key — all Core courses (for QM list enrichment/filtering). */
export async function getAllCoursesFromCore() {
  const res = await fetch(`${config.coreUrl}/api/courses`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core courses fetch failed', res.status, body);
  }
  const data = await res.json();
  return Array.isArray(data.courses) ? data.courses : [];
}
