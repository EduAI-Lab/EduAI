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

/** Unwrap the common list envelopes these three APIs use. */
function toArray(payload, ...keys) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const k of [...keys, 'data', 'items', 'results', 'rows']) {
    if (Array.isArray(payload?.[k])) return payload[k];
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

  const courses = toArray(await getJson(request, `${baseUrl}/api/courses`), 'courses');
  params.courseId = firstId(courses, 'courseId');

  const chats = toArray(await getJson(request, `${baseUrl}/api/chats`), 'chats');
  params.chatId = firstId(chats, 'chatId');

  const disciplines = toArray(await getJson(request, `${baseUrl}/api/disciplines`), 'disciplines');
  // /units/:department/chats keys on the department CODE (e.g. COSC), not an id.
  for (const d of disciplines) {
    const code = d?.code ?? d?.department ?? d?.name;
    if (code) {
      params.department = String(code);
      break;
    }
  }
  // The unit-admin seed account is authorized for COSC, so that is the only
  // department it can actually open if the list endpoint is unavailable.
  params.department ??= 'COSC';

  return params;
}

async function resolveAiTutor(request) {
  const params = {};

  const courses = toArray(await getJson(request, `${AI_TUTOR_API}/api/courses`), 'courses', 'offerings');
  params.courseId = firstId(courses, 'courseId', 'offeringId');
  if (!params.courseId) return params;

  const detail = await getJson(request, `${AI_TUTOR_API}/api/courses/${params.courseId}`);
  const modules = toArray(detail?.modules ?? detail, 'modules');
  params.moduleId =
    firstId(modules, 'moduleId') ??
    firstId(toArray(await getJson(request, `${AI_TUTOR_API}/api/modules?courseId=${params.courseId}`), 'modules'), 'moduleId');
  if (!params.moduleId) return params;

  const moduleDetail = await getJson(request, `${AI_TUTOR_API}/api/modules/${params.moduleId}`);
  const lessons = toArray(moduleDetail?.lessons ?? moduleDetail, 'lessons');
  params.lessonId =
    firstId(lessons, 'lessonId') ??
    firstId(toArray(await getJson(request, `${AI_TUTOR_API}/api/lessons?moduleId=${params.moduleId}`), 'lessons'), 'lessonId');

  return params;
}

async function resolveQuestionMaker(request) {
  const params = {};

  const courses = toArray(await getJson(request, `${QM_API}/api/course`), 'courses');
  params.courseId = firstId(courses, 'courseId');
  if (!params.courseId) return params;

  const questions = toArray(
    await getJson(request, `${QM_API}/api/questions?courseId=${params.courseId}`),
    'questions'
  );
  params.questionId = firstId(questions, 'questionId');

  const assessments = toArray(
    await getJson(request, `${QM_API}/api/assessments?courseId=${params.courseId}`),
    'assessments'
  );
  params.assessmentId = firstId(assessments, 'assessmentId');

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
