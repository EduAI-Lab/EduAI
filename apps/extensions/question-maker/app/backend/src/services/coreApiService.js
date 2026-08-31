/**
 * Thin HTTP client for QM → Core API calls.
 * Each function maps to one Core endpoint and throws on non-success responses
 * (status stored on the error as .status, parsed body as .body).
 */
import { config } from "../config/settings.js";
import { assertQmAiDeadline } from "../middleware/aiAdmission.js";
import { currentCanvasRequestSignal } from "../middleware/canvasRequestContext.js";

function serviceHeaders({ cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
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
    (body?.error === "INVALID_SERVICE_KEY" ||
      body?.error === "Unauthorized" ||
      body?.error === "Forbidden")
  );
}

/**
 * Core caps `pageSize` at 200 (#1041); page-walks and `?ids=` chunks use it.
 */
const CORE_PAGE_SIZE = 200;

/**
 * Safety stop for page-walks so a bad `total` cannot spin forever. An `all`
 * read past this cap throws rather than returning a partial catalog.
 */
const CORE_MAX_PAGES = 50;

/** GET a Core path with service-key headers, mirroring the pre-#1041 catalog read. */
async function readServiceKeyPage(path, { signal } = {}) {
  assertQmAiDeadline({ signal });
  let res;
  try {
    res = await fetch(`${config.coreUrl}${path}`, {
      headers: serviceHeaders(),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) assertQmAiDeadline({ signal });
    throw error;
  }
  assertQmAiDeadline({ signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || "Core courses fetch failed", res.status, body);
  }
  return res.json();
}

/**
 * Read one page of `/api/courses`, or every page when `all` is set.
 * Returns the course array; Core's envelope is unwrapped here.
 */
async function fetchCoursePages(
  authOptions,
  { all = false, page = 1, pageSize = CORE_PAGE_SIZE, search, serviceKeyOnly = false } = {},
) {
  const readPage = async (pageNumber) => {
    const params = new URLSearchParams({
      page: String(pageNumber),
      pageSize: String(Math.min(pageSize, CORE_PAGE_SIZE)),
    });
    if (search) params.set("search", search);
    // `serviceKeyOnly` keeps the pre-#1041 behaviour of the service-key catalog
    // read: send `serviceHeaders()` and let Core answer, rather than refusing
    // to call when no key is configured (`fetchFromCore` throws 503 there).
    const data = serviceKeyOnly
      ? await readServiceKeyPage(`/api/courses?${params}`, authOptions)
      : await fetchFromCore(`/api/courses?${params}`, authOptions);
    return {
      courses: Array.isArray(data?.data) ? data.data : [],
      total: typeof data?.total === "number" ? data.total : 0,
    };
  };

  const first = await readPage(page);
  if (!all) return first.courses;

  const courses = [...first.courses];
  const size = Math.min(pageSize, CORE_PAGE_SIZE);
  const pageCount = Math.ceil(first.total / size) || 1;
  if (pageCount > CORE_MAX_PAGES) {
    // `all` promises the caller's complete visible set. Returning a truncated
    // catalog would let the reconcile flows read the missing tail as "deleted
    // in Core", so this fails instead of silently capping.
    throw coreError(
      `Core returned ${first.total} courses, past the ${CORE_MAX_PAGES}×${size} page-walk cap; ` +
        "refusing to return a partial catalog.",
      502,
    );
  }
  for (let next = page + 1; next <= pageCount; next += 1) {
    courses.push(...(await readPage(next)).courses);
  }
  return courses;
}

/**
 * Calls Core with service-key and/or session-cookie auth.
 * When both are available, retries with the alternate auth mode on auth failures
 * so a stale EDUAI_API_KEY does not block user-session reads — unless `cookieOnly`
 * is set (user-scoped reads must not fall back to the unscoped service key).
 *
 * A `cookieOnly` MUTATION still sends the service key alongside the cookie.
 * Core's cross-origin guard fails closed on any cookie-bearing unsafe method
 * with no Origin/Referer/Sec-Fetch-Site — the exact shape of a server-to-server
 * call — and takes a valid service key as its only non-browser bypass, so the
 * cookie alone earns a 403 CROSS_ORIGIN_MUTATION (#1556). This is not a
 * fallback: the cookie is still the identity Core resolves the caller from, and
 * there is still no key-only variant to degrade to.
 */
async function fetchFromCore(
  path,
  { method = "GET", body, cookie, preferCookie = false, cookieOnly = false, signal } = {},
) {
  assertQmAiDeadline({ signal });
  const url = `${config.coreUrl}${path}`;
  let variants = authHeaderVariants({ cookie, preferCookie });
  if (cookieOnly) {
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    const serviceKey = isMutation && config.eduaiApiKey ? config.eduaiApiKey : null;
    variants = cookie
      ? [serviceKey ? { cookie, Authorization: `Bearer ${serviceKey}` } : { cookie }]
      : [];
  }

  if (variants.length === 0) {
    throw coreError("EDUAI_API_KEY not configured and no session cookie available", 503, {
      error: "CORE_SERVICE_UNAVAILABLE",
    });
  }

  let lastError;
  for (const authHeaders of variants) {
    let res;
    try {
      const init = {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders },
        signal,
      };
      // Reads default to GET, which must not carry a body at all.
      if (body !== undefined) init.body = JSON.stringify(body);
      res = await fetch(url, init);
    } catch (error) {
      if (signal?.aborted) assertQmAiDeadline({ signal });
      throw error;
    }
    assertQmAiDeadline({ signal });
    if (res.ok) return res.json();

    const errBody = await res.json().catch(() => ({}));
    const err = coreError(errBody.error || "Core request failed", res.status, errBody);
    if (variants.length > 1 && isRetryableAuthFailure(res.status, errBody)) {
      lastError = err;
      continue;
    }
    throw err;
  }

  throw lastError;
}

function coreError(message, status, body) {
  const code =
    typeof body?.error === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(body.error)
      ? body.error
      : null;
  const error = Object.assign(new Error(code || "Core request failed"), { status, body });
  // Only a machine-readable Core code is safe to relay to the caller; a free
  // text message stays internal, so `isPublic` rides along with `code` alone.
  if (code) {
    error.code = code;
    error.isPublic = true;
  }
  return error;
}

/** GET /api/courses/:courseId/topics — returns { topics: [{ id, name }] } (deleted topics excluded by Core) */
export async function getCourseTopicsFromCore(coreCourseId, opts = {}) {
  const cookie = opts.cookie ?? "";
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
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    if (!body.existingId) {
      throw coreError(
        "Topic exists in Core but has been deleted; restore it there before syncing",
        409,
        body,
      );
    }
    return { id: body.existingId };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || "Core topic push failed", res.status, body);
  }
  const data = await res.json();
  return { id: data.id };
}

/**
 * POST /api/questions — session-only endpoint on Core.
 * Forwards the caller's session cookie so Core can authenticate the user
 * and derive createdBy from the session.
 *
 * The service key rides along for the same reason the Canvas mutations carry
 * it: Core's cross-origin guard fails closed on a cookie-bearing unsafe method
 * with no Origin/Referer/Sec-Fetch-Site — the shape of every server-to-server
 * call — and takes a valid key as its only non-browser bypass. Without it this
 * push has answered 403 CROSS_ORIGIN_MUTATION since the guard landed, leaving
 * approved variants stranded with no Core question. The cookie remains the
 * identity; the key only proves the caller is trusted.
 */
export async function pushQuestionToCore(payload, cookieHeader) {
  const headers = {
    "Content-Type": "application/json",
    cookie: cookieHeader ?? "",
  };
  if (config.eduaiApiKey) {
    headers.Authorization = `Bearer ${config.eduaiApiKey}`;
  }

  const res = await fetch(`${config.coreUrl}/api/questions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || "Core question push failed", res.status, body);
  }
  return res.json();
}

/**
 * PATCH /api/questions/:id — toggles testable on Core.
 * Returns null on 404 QUESTION_NOT_FOUND so callers can null their core_question_id.
 */
export async function patchQuestionTestableOnCore(coreQuestionId, testable) {
  const res = await fetch(`${config.coreUrl}/api/questions/${coreQuestionId}`, {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ testable }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || "Core question patch failed", res.status, body);
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
    signal: opts.signal,
  }).catch((err) => {
    if (opts.signal?.aborted) assertQmAiDeadline({ signal: opts.signal });
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
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) assertQmAiDeadline({ signal: opts.signal });
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * GET /api/courses — session-scoped course list for instructor UI flows (#578).
 * Forwards the caller's Core session cookie so Core applies `buildCourseListFilter`
 * (INSTRUCTOR/TA enrollments, etc.). Do not use the service key for course pickers.
 *
 * Core requires `page`/`pageSize` (#1041) and answers with
 * `{ data, total, page, pageSize }`. Callers that need the caller's complete
 * visible set pass `all: true` and pay for the page-walk explicitly.
 */
export async function listCoursesFromCore(cookieHeader, options = {}) {
  return fetchCoursePages({ cookie: cookieHeader, preferCookie: true, cookieOnly: true }, options);
}

/**
 * Returns true when `coreCourseId` is in the caller's scoped Core list (#578).
 *
 * Uses the `?ids=` lookup (#1125): one request for the single course in
 * question, still cookie-scoped so Core answers empty when the caller cannot
 * see it. This used to scan the caller's whole course list.
 */
export async function isCoreCourseInScopedList(coreCourseId, cookieHeader) {
  const courses = await getCoursesByIdsFromCore([coreCourseId], {
    cookie: cookieHeader,
    preferCookie: true,
    cookieOnly: true,
  });
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
export async function getMyProfileFromCore(cookieHeader, opts = {}) {
  assertQmAiDeadline({ signal: opts.signal });
  let res;
  try {
    res = await fetch(`${config.coreUrl}/api/me`, {
      headers: { cookie: cookieHeader ?? "" },
      signal: opts.signal,
    });
  } catch (error) {
    if (opts.signal?.aborted) assertQmAiDeadline({ signal: opts.signal });
    throw error;
  }
  assertQmAiDeadline({ signal: opts.signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw coreError(body.error || "Core profile fetch failed", res.status, body);
  }
  return res.json();
}

/**
 * GET /api/courses via service key — Core's whole catalog, page-walked (#1041).
 *
 * Prefer `getCoursesByIdsFromCore` whenever the caller already knows which
 * `coreCourseId`s it wants to join against; this walk exists for the ADMIN list,
 * which materializes a local anchor per Core course and so has no id set to
 * narrow by.
 */
export async function getAllCoursesFromCore() {
  return fetchCoursePages({}, { all: true, serviceKeyOnly: true });
}

/**
 * GET /api/courses?ids= — resolve a known set of Core courses in one unpaged
 * lookup (#1125). Chunked, since Core caps the id list.
 */
export async function getCoursesByIdsFromCore(
  ids,
  authOptions = {},
  { serviceKeyOnly = false } = {},
) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (unique.length === 0) return [];

  const courses = [];
  for (let start = 0; start < unique.length; start += CORE_PAGE_SIZE) {
    const chunk = unique.slice(start, start + CORE_PAGE_SIZE);
    const path = `/api/courses?ids=${encodeURIComponent(chunk.join(","))}`;
    const data = serviceKeyOnly
      ? await readServiceKeyPage(path, authOptions)
      : await fetchFromCore(path, authOptions);
    if (Array.isArray(data?.data)) courses.push(...data.data);
  }
  return courses;
}

/** GET /api/courses?search= — Core-side course search (#1125). */
export async function searchCoursesFromCore(
  search,
  authOptions = {},
  { serviceKeyOnly = false } = {},
) {
  const params = new URLSearchParams({
    page: "1",
    pageSize: String(CORE_PAGE_SIZE),
    search,
  });
  const path = `/api/courses?${params}`;
  const data = serviceKeyOnly
    ? await readServiceKeyPage(path, authOptions)
    : await fetchFromCore(path, authOptions);
  return Array.isArray(data?.data) ? data.data : [];
}

function canvasCourseQuery(canvasCourseId) {
  return `canvasCourseId=${encodeURIComponent(canvasCourseId)}`;
}

/** The caller-disconnect failure, distinct from any upstream Core error. */
function canvasRequestCancelledError() {
  return Object.assign(new Error("Canvas request cancelled by the caller"), {
    status: 499,
    code: "CANVAS_REQUEST_CANCELLED",
    body: { error: "CANVAS_REQUEST_CANCELLED" },
    isPublic: true,
  });
}

/**
 * Every Canvas proxy call inherits the caller-disconnect signal published by
 * `canvasRequestContext`, so abandoning the browser request aborts the QM→Core
 * fetch — and with it Core's Canvas egress — rather than leaving it running for
 * nobody. The abort is reported as its own cancellation error so it is never
 * mistaken for a Core or Canvas failure.
 */
async function canvasCookieFetch(path, cookie, { method = "GET", body } = {}) {
  const signal = currentCanvasRequestSignal();
  if (signal?.aborted) throw canvasRequestCancelledError();

  try {
    return await fetchFromCore(path, { method, body, cookie, cookieOnly: true, signal });
  } catch (error) {
    if (signal?.aborted) throw canvasRequestCancelledError();
    throw error;
  }
}

/** GET /api/canvas/integration — caller's Core Canvas integration (session-only). */
export async function proxyCoreCanvasGetIntegration(cookie) {
  return canvasCookieFetch("/api/canvas/integration", cookie);
}

/** POST /api/canvas/connect — save the caller's Canvas credentials on Core. */
export async function proxyCoreCanvasConnect(cookie, body) {
  return canvasCookieFetch("/api/canvas/connect", cookie, { method: "POST", body });
}

/** DELETE /api/canvas/disconnect — remove the caller's Core Canvas integration. */
export async function proxyCoreCanvasDisconnect(cookie) {
  return canvasCookieFetch("/api/canvas/disconnect", cookie, { method: "DELETE" });
}

/** GET /api/canvas/courses — list Canvas courses via the caller's Core integration. */
export async function proxyCoreCanvasListCourses(cookie) {
  return canvasCookieFetch("/api/canvas/courses", cookie);
}

/** GET /api/canvas/quizzes?canvasCourseId= — list quizzes in a Canvas course. */
export async function proxyCoreListQuizzes(cookie, canvasCourseId) {
  return canvasCookieFetch(`/api/canvas/quizzes?${canvasCourseQuery(canvasCourseId)}`, cookie);
}

/** GET /api/canvas/quizzes/:quizId?canvasCourseId= — fetch one Canvas quiz. */
export async function proxyCoreGetQuiz(cookie, canvasCourseId, quizId) {
  return canvasCookieFetch(
    `/api/canvas/quizzes/${encodeURIComponent(quizId)}?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
  );
}

/** GET /api/canvas/quizzes/:quizId/questions?canvasCourseId= — list quiz questions. */
export async function proxyCoreListQuizQuestions(cookie, canvasCourseId, quizId) {
  return canvasCookieFetch(
    `/api/canvas/quizzes/${encodeURIComponent(quizId)}/questions?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
  );
}

/** GET /api/canvas/quizzes/:quizId/questions/:questionId?canvasCourseId= — fetch one question. */
export async function proxyCoreGetQuizQuestion(cookie, canvasCourseId, quizId, questionId) {
  return canvasCookieFetch(
    `/api/canvas/quizzes/${encodeURIComponent(quizId)}/questions/${encodeURIComponent(questionId)}?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
  );
}

/** POST /api/canvas/quizzes — create a Canvas quiz. */
export async function proxyCoreCreateQuiz(cookie, canvasCourseId, quiz) {
  return canvasCookieFetch("/api/canvas/quizzes", cookie, {
    method: "POST",
    body: { canvasCourseId, quiz },
  });
}

/** POST /api/canvas/quizzes/:quizId/questions — create a Canvas quiz question. */
export async function proxyCoreCreateQuizQuestion(cookie, canvasCourseId, quizId, question) {
  return canvasCookieFetch(`/api/canvas/quizzes/${encodeURIComponent(quizId)}/questions`, cookie, {
    method: "POST",
    body: { canvasCourseId, question },
  });
}

/** DELETE /api/canvas/quizzes/:quizId — compensate a failed multi-step export. */
export async function proxyCoreDeleteQuiz(cookie, canvasCourseId, quizId) {
  return canvasCookieFetch(
    `/api/canvas/quizzes/${encodeURIComponent(quizId)}?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
    { method: "DELETE" },
  );
}

/** GET /api/canvas/question-banks?canvasCourseId= — list Classic Canvas question banks. */
export async function proxyCoreListQuestionBanks(cookie, canvasCourseId) {
  return canvasCookieFetch(
    `/api/canvas/question-banks?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
  );
}

/** GET /api/canvas/question-banks/:bankId — fetch one Canvas question bank. */
export async function proxyCoreGetQuestionBank(cookie, canvasCourseId, canvasBankId) {
  return canvasCookieFetch(
    `/api/canvas/question-banks/${encodeURIComponent(canvasBankId)}?${canvasCourseQuery(canvasCourseId)}`,
    cookie,
  );
}

/**
 * GET /api/canvas/question-banks/:bankId/questions — list bank questions (one page).
 * Optional query: page, perPage.
 */
export async function proxyCoreListQuestionBankQuestions(
  cookie,
  canvasCourseId,
  canvasBankId,
  { page = 1, perPage = 100 } = {},
) {
  const qs = new URLSearchParams({
    canvasCourseId: String(canvasCourseId),
    page: String(page),
    perPage: String(perPage),
  });
  return canvasCookieFetch(
    `/api/canvas/question-banks/${encodeURIComponent(canvasBankId)}/questions?${qs}`,
    cookie,
  );
}

/** GET /api/courses/:courseId/banks */
export async function listQuestionBanksFromCore(coreCourseId, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks`, opts);
}

/** POST /api/courses/:courseId/banks */
export async function createQuestionBankOnCore(coreCourseId, payload, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks`, {
    method: "POST",
    body: payload,
    ...opts,
  });
}

/** PUT /api/courses/:courseId/banks/:bankId */
export async function updateQuestionBankOnCore(coreCourseId, bankId, payload, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks/${bankId}`, {
    method: "PUT",
    body: payload,
    ...opts,
  });
}

/** DELETE /api/courses/:courseId/banks/:bankId */
export async function deleteQuestionBankOnCore(coreCourseId, bankId, payload = {}, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks/${bankId}`, {
    method: "DELETE",
    body: payload,
    ...opts,
  });
}

/** GET /api/courses/:courseId/banks/:bankId/questions */
export async function listQuestionBankMembershipsFromCore(coreCourseId, bankId, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks/${bankId}/questions`, opts);
}

/** POST /api/courses/:courseId/banks/:bankId/questions */
export async function addQuestionBankMembershipOnCore(coreCourseId, bankId, payload, opts = {}) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks/${bankId}/questions`, {
    method: "POST",
    body: payload,
    ...opts,
  });
}

/** POST bulk memberships — body `{ memberships: [...] }` */
export async function addQuestionBankMembershipsOnCore(
  coreCourseId,
  bankId,
  memberships,
  opts = {},
) {
  return fetchFromCore(`/api/courses/${coreCourseId}/banks/${bankId}/questions`, {
    method: "POST",
    body: { memberships },
    ...opts,
  });
}

/** DELETE /api/courses/:courseId/banks/:bankId/questions/:externalQuestionId */
export async function removeQuestionBankMembershipOnCore(
  coreCourseId,
  bankId,
  externalQuestionId,
  source = "question-maker",
  opts = {},
) {
  const qs = `?source=${encodeURIComponent(source)}`;
  return fetchFromCore(
    `/api/courses/${coreCourseId}/banks/${bankId}/questions/${externalQuestionId}${qs}`,
    { method: "DELETE", ...opts },
  );
}
