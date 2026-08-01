/**
 * Runtime resolution of dynamic route segments (:courseId, :chatId, ...).
 *
 * A route like /courses/:courseId is only worth profiling against a row that
 * actually exists — profiling a 404 measures the error boundary. So before any
 * page with `params` is measured, its ids are fetched from the owning app's own
 * API using the same session cookie the browser will use.
 *
 * Every resolver is failure-tolerant: a missing endpoint, an unexpected shape,
 * or an empty list yields `undefined`, and the caller reports the page as
 * SKIPPED with a reason rather than measuring a broken URL. Shapes are probed
 * loosely (array | {data} | {items} | {courses} | ...) so a wrapper-key change
 * in any of the three APIs degrades to a skip, not a wrong number.
 */

const AI_TUTOR_API = process.env.AI_TUTOR_API_URL || 'http://localhost:4000';
const QM_API = process.env.QM_API_URL || 'http://localhost:8000';

/** GET + parse JSON, swallowing every failure mode into undefined. */
async function getJson(request, url) {
  try {
    const res = await request.get(url, { timeout: 15_000, failOnStatusCode: false });
    if (!res.ok()) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * All three APIs reject an unpaged list with `400 PAGINATION_REQUIRED`, so every
 * list URL carries explicit paging. A leaf lookup only needs the first row, but a
 * list the resolver *walks* (courses, modules) is searching for the first entry
 * that actually owns children, and seeded content clusters — so give those a
 * wide window rather than letting coverage depend on which rows sort first.
 */
const paged = (url, pageSize = 5) => `${url}${url.includes('?') ? '&' : '?'}page=1&pageSize=${pageSize}`;
const WALK = 50;

/**
 * Unwrap the common list envelopes these three APIs use. Question Maker nests
 * twice — `{ success, data: { items: [...] } }` — so a single-level lookup finds
 * `data`, sees an object rather than an array, and silently yields nothing;
 * that alone was enough to report every question/assessment page as skipped.
 * Descend through object-valued candidates instead of only checking the top.
 */
function toArray(payload, ...keys) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [...keys, 'data', 'items', 'results', 'rows'];
  for (const k of candidates) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  for (const k of candidates) {
    const nested = payload?.[k];
    if (nested && typeof nested === 'object') {
      const found = toArray(nested, ...keys);
      if (found.length) return found;
    }
  }
  return [];
}

/** First usable id in a list, tolerating id / _id / uuid naming. */
function firstId(list, ...idKeys) {
  for (const row of list) {
    for (const k of [...idKeys, 'id', '_id', 'uuid']) {
      if (row?.[k] != null) return String(row[k]);
    }
  }
  return undefined;
}

async function resolveCore(request, baseUrl) {
  const params = {};

  const courses = toArray(await getJson(request, paged(`${baseUrl}/api/courses`)), 'courses');
  params.courseId = firstId(courses, 'courseId');

  const chats = toArray(await getJson(request, paged(`${baseUrl}/api/chats`)), 'chats');
  params.chatId = firstId(chats, 'chatId');

  // /units/:department/chats keys on the department CODE (e.g. COSC), not an id,
  // and the loader rejects any code outside the caller's `authorizedUnits` with
  // a redirect to /courses?access=denied. Taking disciplines[0] therefore picks
  // AGRO for a COSC unit admin and profiles the access-denied page — so ask what
  // this session is actually authorized for first, and only fall back to the
  // global list for roles (ADMIN) that carry no per-unit restriction.
  const me = await getJson(request, `${baseUrl}/api/me`);
  const authorized = Array.isArray(me?.authorizedUnits) ? me.authorizedUnits.filter(Boolean) : [];
  if (authorized.length) {
    params.department = String(authorized[0]);
  } else {
    const disciplines = toArray(await getJson(request, `${baseUrl}/api/disciplines`), 'disciplines');
    for (const d of disciplines) {
      const code = d?.code ?? d?.department ?? d?.name;
      if (code) {
        params.department = String(code);
        break;
      }
    }
  }
  // The unit-admin seed account is authorized for COSC, so that is the only
  // department it can open if both endpoints are unavailable.
  params.department ??= 'COSC';

  return params;
}

/**
 * AI Tutor nests its content endpoints (`/courses/:id/modules`,
 * `/modules/:id/lessons`) — there is no flat `/modules` or `/lessons` list, and
 * a course's detail payload carries no `modules` array. Content is sparse
 * (plenty of courses have no modules, plenty of modules no lessons), so walk
 * down until a course→module→lesson chain that actually exists is found rather
 * than trusting the first of each.
 */
async function resolveAiTutor(request) {
  const params = {};

  const courses = toArray(await getJson(request, paged(`${AI_TUTOR_API}/api/courses`, WALK)), 'courses', 'offerings');
  if (!courses.length) return params;
  params.courseId = firstId(courses, 'courseId', 'offeringId');

  for (const course of courses) {
    const courseId = firstId([course], 'courseId', 'offeringId');
    if (!courseId) continue;

    const modules = toArray(
      await getJson(request, paged(`${AI_TUTOR_API}/api/courses/${courseId}/modules`, WALK)),
      'modules'
    );
    if (!modules.length) continue;

    // A module id is only usable once we know the course it hangs off renders.
    params.courseId = courseId;
    params.moduleId ??= firstId(modules, 'moduleId');

    for (const mod of modules) {
      const moduleId = firstId([mod], 'moduleId');
      if (!moduleId) continue;
      const lessons = toArray(
        await getJson(request, paged(`${AI_TUTOR_API}/api/modules/${moduleId}/lessons`)),
        'lessons'
      );
      const lessonId = firstId(lessons, 'lessonId');
      if (!lessonId) continue;
      params.moduleId = moduleId;
      params.lessonId = lessonId;
      return params;
    }
  }

  return params;
}

async function resolveQuestionMaker(request) {
  const params = {};

  const courses = toArray(await getJson(request, paged(`${QM_API}/api/course`, WALK)), 'courses');
  if (!courses.length) return params;
  params.courseId = firstId(courses, 'courseId');

  // The first course is not guaranteed to own any questions or assessments —
  // seeded content clusters on a few courses — so walk the page until one does.
  // /courses/:courseId itself only needs the first id, which is already set.
  for (const course of courses) {
    const courseId = firstId([course], 'courseId');
    if (!courseId) continue;

    const questions = toArray(await getJson(request, paged(`${QM_API}/api/questions?courseId=${courseId}`)), 'questions');
    const assessments = toArray(
      await getJson(request, paged(`${QM_API}/api/assessments?courseId=${courseId}`)),
      'assessments'
    );
    const questionId = firstId(questions, 'questionId');
    const assessmentId = firstId(assessments, 'assessmentId');
    if (!questionId && !assessmentId) continue;

    // Keep the ids self-consistent: a question/assessment id is only valid in
    // the URL of the course it belongs to.
    params.courseId = courseId;
    params.questionId = questionId;
    params.assessmentId = assessmentId;
    if (questionId && assessmentId) break;
  }

  return params;
}

/**
 * Resolve every dynamic segment an app needs, for one role's session.
 * Resolution is per (app, role) because what a student can list differs from
 * what an instructor or admin can — a student must profile a course they are
 * enrolled in, not the first course in the database.
 */
export async function resolveParams(request, appKey, coreBaseUrl) {
  switch (appKey) {
    case 'core':
      return resolveCore(request, coreBaseUrl);
    case 'aiTutor':
      return resolveAiTutor(request);
    case 'questionMaker':
      return resolveQuestionMaker(request);
    default:
      return {};
  }
}

/** Substitute :params into a path; returns the missing key if one is unresolved. */
export function fillPath(pathTemplate, needed, params) {
  const missing = (needed ?? []).filter((k) => !params?.[k]);
  if (missing.length) return { missing };
  return {
    path: pathTemplate.replace(/:([A-Za-z0-9_]+)/g, (_, k) => encodeURIComponent(params[k])),
  };
}
