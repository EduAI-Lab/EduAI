/**
 * Thin HTTP client for QM → Core API calls.
 * Each function maps to one Core endpoint and throws on non-success responses
 * (status stored on the error as .status, parsed body as .body).
 */
import { config } from '../config/settings.js';

function serviceHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.eduaiApiKey}`,
  };
}

function coreError(message, status, body) {
  return Object.assign(new Error(message), { status, body });
}

/** GET /api/courses/:courseId/topics — returns { topics: [{ id, name }] } (deleted topics excluded by Core) */
export async function getCourseTopicsFromCore(coreCourseId) {
  const res = await fetch(`${config.coreUrl}/api/courses/${coreCourseId}/topics`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core topics fetch failed', res.status, body);
  }
  return res.json();
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
export async function getCourseEnrollmentsFromCore(coreCourseId) {
  const res = await fetch(`${config.coreUrl}/api/courses/${coreCourseId}/enrollments`, {
    headers: serviceHeaders(),
  });
  if (res.status === 404) return { enrollments: [] };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core enrollments fetch failed', res.status, body);
  }
  return res.json();
}

/**
 * GET /api/courses/:id via the service key — returns the Core course row
 * (including `department`, needed for the UNIT_ADMIN unit lock).
 * Returns null when the course no longer exists in Core (404).
 */
export async function getCourseFromCore(coreCourseId) {
  const res = await fetch(`${config.coreUrl}/api/courses/${coreCourseId}`, {
    headers: serviceHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || 'Core course fetch failed', res.status, body);
  }
  return res.json();
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
