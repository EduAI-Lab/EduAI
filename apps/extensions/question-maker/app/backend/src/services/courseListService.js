/**
 * Role-scoped QM course listing — mirrors Core's buildCourseListFilter (§5).
 * Access for the non-ADMIN branch is derived from ONE cookie-scoped Core list
 * call per request (`deriveListAccess`, #1072 unified contract), not a per-row
 * `resolveAccessForCourse` roster fetch — see that function's docstring for
 * the callerEnrollmentRole-vs-roster parity analysis.
 */
import { prisma } from '../config/database.js';
import { LEVELS, getAuthorizedUnits } from '../middleware/courseAccess.js';
import {
  getAllCoursesFromCore,
  getCourseFromCore,
  getCoursesByIdsFromCore,
  listCoursesFromCore,
  searchCoursesFromCore,
} from './coreApiService.js';
import { dedupeCoursesByCoreId, normalizeCourseCode } from './courseCodeUtils.js';

const MIN_LIST_RANK = LEVELS.instructor.rank;
const ACCESS_SYNC_TTL_MS = Number(process.env.COURSE_ACCESS_SYNC_TTL_MS) || 60_000;
const accessSyncedAtByUser = new Map();

/** Placeholder shown when a linked course's Core row can't be resolved right now. */
const CORE_UNAVAILABLE_NAME = 'Course unavailable';

/**
 * Projects Core-owned fields (`name`, `code`, `department`, `term`, `year`,
 * `description`) onto a local QM course row (#1076/#1072 §3).
 *
 * `name`/`code` are Core-owned — never fall back to a local column (there is
 * none; `Course` dropped `name`/`code` entirely, #1072 §4 step 10), even when
 * Core didn't resolve (that would resurrect the exact staleness bug this
 * closes). Degrade instead: a placeholder name and null code (locked
 * decision: degrade, not stale).
 *
 * A row without `coreCourseId` has no Core row to read through (creation
 * requires `coreCourseId` post-sandbox-removal, #1072 step 7, so this should
 * be unreachable in practice) — still degrades to the same placeholder rather
 * than reading a local field that no longer exists.
 */
function projectCoreFields(row, core) {
  const linked = Boolean(row.coreCourseId);

  if (!linked || !core) {
    return {
      name: CORE_UNAVAILABLE_NAME,
      code: null,
      department: null,
      term: null,
      year: null,
      description: null,
      isPublished: null,
      coreUnavailable: true,
    };
  }

  return {
    name: core.name,
    code: core.code ?? null,
    department: core.department ?? null,
    term: core.term ?? null,
    year: core.year ?? null,
    description: core.description ?? null,
    // Display-only (QM has no student publish gate — that's AT/Core's job):
    // surfaced so the UI badges the course's real Core publish state instead
    // of a hardcoded value. Null when unresolved.
    isPublished: typeof core.isPublished === 'boolean' ? core.isPublished : null,
    coreUnavailable: false,
  };
}

/** Batched-list variant: `core` is looked up from a pre-fetched `coreById` map. */
function enrichCourseRow(course, coreById, accessLevel) {
  const row = course;
  const core = row.coreCourseId ? coreById.get(row.coreCourseId) : null;
  return {
    ...row,
    ...projectCoreFields(row, core),
    accessLevel: accessLevel ?? null,
  };
}

/**
 * Single-course read-through for detail/update surfaces (GET/PUT
 * /api/course/:id, PATCH .../link-core). Fetches the linked Core course
 * directly (§3 "detail from GET /api/courses/:id") — degrades gracefully
 * (placeholder, not a hard error) when Core is unreachable.
 */
export async function enrichCourseDetail(course, { cookie } = {}) {
  const row = course;

  let core = null;
  if (row.coreCourseId) {
    try {
      // Service-key mode first (`preferCookie: false`): this is a pure FIELD
      // read, not an identity-gated one, so it should never route through
      // Core's session-RBAC branch (which can 403 on a caller/course mismatch
      // that QM's own gate already resolved differently, and whose body
      // doesn't always match `isRetryableAuthFailure`'s literal error strings
      // — a fragile retry edge that silently degraded a resolvable course to
      // a placeholder). `cookie` stays as the fallback variant for
      // environments with no EDUAI_API_KEY configured (#1072 unified contract).
      core = await getCourseFromCore(row.coreCourseId, { cookie, preferCookie: false });
    } catch {
      core = null; // Core unreachable — degrade the detail response, don't hard-error.
    }
  }

  return { ...row, ...projectCoreFields(row, core) };
}

/**
 * Batched read-through for arrays of rows carrying a nested `course` object
 * (question/assessment lists, e.g. `getQuestionsByUser`/`getAssessmentsByUser`).
 * ONE `?ids=` lookup regardless of row count — never a per-row Core fetch
 * (locked decision: no N+1) — mirroring `listCoursesForUser`. #1041 removed the
 * full-catalog read this used to do; the ids come from the rows themselves.
 * Rows without a `course` field (or whose nested course lacks `coreCourseId`
 * in its `attributes`) pass through unchanged.
 */
export async function enrichRowsWithCourse(rows) {
  const wantedIds = rows.map((row) => row.course?.coreCourseId).filter(Boolean);

  let coreById = new Map();
  try {
    // Service-key read, as the `getAllCoursesFromCore` call this replaced was:
    // the rows are already access-checked locally, this only resolves names.
    const coreCourses = await getCoursesByIdsFromCore(wantedIds, {}, { serviceKeyOnly: true });
    coreById = new Map(coreCourses.map((c) => [c.id, c]));
  } catch {
    // Core unreachable — rows still return; nested course degrades to placeholder.
  }

  return rows.map((row) => {
    const plain = row;
    if (!plain.course) return plain;
    const core = plain.course.coreCourseId ? coreById.get(plain.course.coreCourseId) : null;
    return { ...plain, course: { ...plain.course, ...projectCoreFields(plain.course, core) } };
  });
}

/**
 * Single-row counterpart of `enrichRowsWithCourse` for detail/update surfaces
 * that eager-load one nested `course` (e.g. `getQuestionById`, `getAssessmentById`).
 */
export async function enrichRowWithCourse(row) {
  const plain = row;
  if (!plain.course) return plain;
  return { ...plain, course: await enrichCourseDetail(plain.course) };
}

/**
 * Legacy-shaped "semester" display string derived from a Core-projected term/year,
 * e.g. "Winter Term 1 2026" (#1072 §4 step 8 / #1077). QM's `Assessments.semester`
 * column is derive-only now — nothing persists free-form semester text anymore.
 * Mirrors `termLabelLong` in packages/ui/src/lib/term.ts; duplicated here in plain
 * JS because QM's backend has no dependency on the frontend-only @eduai/ui package.
 * Keep the season-word mapping in sync with that file if it ever changes.
 *
 * `year` here is always the ACADEMIC-year label read straight through from
 * Core (`core.year` via `projectCoreFields` below) — never derived locally.
 * A W2 course spanning Jan-Apr is labelled with the PREVIOUS calendar year
 * (#1088; see `termInfoFromDate` in packages/ui/src/lib/term.ts). QM does no
 * date-based derivation of its own, so it inherits this convention for free
 * via read-through — nothing to change here beyond this note.
 */
const SEMESTER_TERM_NAMES = {
  W1: 'Winter Term 1',
  W2: 'Winter Term 2',
  S1: 'Summer Term 1',
  S2: 'Summer Term 2',
};

export function formatSemesterDisplay(term, year) {
  const name = term ? SEMESTER_TERM_NAMES[term] : null;
  if (name && year != null) return `${name} ${year}`;
  if (name) return name;
  if (year != null) return String(year);
  return 'Unscheduled';
}

/**
 * One-shot Core lookup + format for assessment-create paths that don't already
 * have an enriched course row on hand (#1072 §4 step 8 / #1077). One Core call
 * per creation event — not a list/read hot path, so this doesn't reintroduce the
 * per-row N+1 the batched read paths (`enrichRowsWithCourse` et al.) avoid.
 * Degrades to 'Unscheduled' when the course isn't linked or Core is unreachable.
 */
export async function deriveSemesterDisplayForCourseId(courseId, { cookie } = {}) {
  if (!courseId) return formatSemesterDisplay(null, null);
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, coreCourseId: true },
  });
  if (!course) return formatSemesterDisplay(null, null);
  const detail = await enrichCourseDetail(course, { cookie });
  return formatSemesterDisplay(detail.term, detail.year);
}

/**
 * List QM courses visible to the caller at instructor rank or above.
 * ADMIN sees Core's full catalog (materializing anchors as needed, see
 * below); UNIT_ADMIN / INSTRUCTOR are filtered via courseAccess over the
 * local rows only.
 */
export async function listCoursesForUser(reqUser, { cookie } = {}) {
  // `id` breaks ties so the caller's offset slice is stable across requests:
  // ADMIN anchor materialization below creates many rows in one statement,
  // giving them an identical `createdAt` that would otherwise let a course show
  // up on two pages while another never appears.
  const allCourses = await prisma.course.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  });

  let coreById = new Map();
  try {
    // #1041: ADMIN's list is Core's whole catalog (it materializes an anchor per
    // Core course below), so that branch still walks every page. Everyone else
    // only ever joins against the local rows, so an `?ids=` lookup suffices.
    const coreCourses =
      reqUser.role === 'ADMIN'
        ? await getAllCoursesFromCore()
        : await getCoursesByIdsFromCore(
            allCourses.map((c) => c.coreCourseId),
            {},
            { serviceKeyOnly: true },
          );
    coreById = new Map(coreCourses.map((c) => [c.id, c]));
  } catch {
    // Core unreachable — list still works without department enrichment.
  }

  if (reqUser.role === 'ADMIN') {
    // #1074: ADMIN's list = Core's full catalog, not just locally-anchored
    // rows — materialize an anchor for every Core course that doesn't have
    // one yet, so the client always has a real local id to route by (mirrors
    // ai-tutor's `ensureOfferingAnchors`, apps/extensions/ai-tutor/server/src/
    // services/importTaughtCoursesService.js). Batched: `allCourses` above is
    // already every local row unfiltered, so the "existing ids" read is free
    // — no extra findMany. One createMany for the missing set, idempotent via
    // `ignoreDuplicates` (Postgres ON CONFLICT DO NOTHING on the unique
    // `core_course_id` index) so concurrent admin requests racing to
    // materialize the same course never error. Core unreachable ⇒ coreById is
    // empty ⇒ nothing to materialize ⇒ falls through to the existing local
    // rows with placeholder projection (degrade, not error).
    const existingCoreCourseIds = new Set(
      allCourses.map((c) => c.coreCourseId).filter(Boolean),
    );
    const missingCoreCourseIds = Array.from(coreById.keys()).filter(
      (id) => !existingCoreCourseIds.has(id),
    );

    let adminCourses = allCourses;
    if (missingCoreCourseIds.length > 0) {
      await prisma.course.createMany({
        data: missingCoreCourseIds.map((coreCourseId) => ({ userId: reqUser.id, coreCourseId })),
        skipDuplicates: true,
      });
      // Re-fetch: createMany doesn't return the created rows, and a racing
      // request may have inserted some of these rows first — read back the
      // ground truth.
      adminCourses = await prisma.course.findMany({ orderBy: { createdAt: 'desc' } });
    }

    // Catalog-sourced dedupe: an existing local anchor and a freshly
    // materialized one can both resolve to the same Core course; merge them
    // on Core identity same as before.
    const enriched = adminCourses.map((course) => enrichCourseRow(course, coreById, 'admin'));
    return dedupeCoursesByCoreId(enriched);
  }

  // Non-ADMIN list (UNIT_ADMIN / INSTRUCTOR, and any TA/STUDENT caller who
  // happens to hit this endpoint): resolve access for every row from ONE
  // cookie-scoped Core list call, not a per-row roster fetch (#1072 unified
  // contract — this replaced an N+1 that called `getCourseEnrollmentsFromCore`
  // once per local course row). `resolveAccessForCourse` (per-course roster
  // read) stays in place for single-course routes, where one Core call per
  // request was never the problem.
  let roleByCoreId = new Map();
  try {
    // #1041: `callerEnrollmentRole` is only on the cookie-scoped list, and every
    // local row needs a verdict, so this walks the caller's pages.
    const scopedCourses = await listCoursesFromCore(cookie, { all: true });
    roleByCoreId = new Map(scopedCourses.map((c) => [c.id, c.callerEnrollmentRole ?? null]));
  } catch {
    // Core unreachable — every row falls through to the owner-fallback below,
    // same degrade as the old per-row path (§5 "Core-down" unchanged).
  }

  const authorizedUnits =
    reqUser.role === 'UNIT_ADMIN' ? await getAuthorizedUnits(reqUser, cookie) : [];

  const visible = [];
  for (const course of allCourses) {
    const row = course;
    const access = deriveListAccess(reqUser, row, { coreById, roleByCoreId, authorizedUnits });
    if (access && access.rank >= MIN_LIST_RANK) {
      visible.push(enrichCourseRow(course, coreById, access.level));
    }
  }
  return visible;
}

/** Refresh the caller's Core enrollment snapshot at most once per TTL. */
async function syncCourseAccessMirror(reqUser, cookie) {
  const now = Date.now();
  if (now - (accessSyncedAtByUser.get(reqUser.id) ?? 0) < ACCESS_SYNC_TTL_MS) return;

  const scopedCourses = await listCoursesFromCore(cookie, { all: true });
  const coreIds = scopedCourses.map((course) => course?.id).filter(Boolean);
  const anchors = coreIds.length
    ? await prisma.course.findMany({
        where: { coreCourseId: { in: coreIds } },
        select: { id: true, coreCourseId: true },
      })
    : [];
  const anchorByCoreId = new Map(anchors.map((course) => [course.coreCourseId, course]));

  await prisma.courseAccess.deleteMany({ where: { userId: reqUser.id } });
  const accessRows = scopedCourses.flatMap((course) => {
    const anchor = anchorByCoreId.get(course.id);
    if (!anchor || !course.callerEnrollmentRole) return [];
    return [{
      userId: reqUser.id,
      courseId: anchor.id,
      role: course.callerEnrollmentRole,
      department: course.department ?? null,
    }];
  });
  if (accessRows.length) await prisma.courseAccess.createMany({ data: accessRows, skipDuplicates: true });
  accessSyncedAtByUser.set(reqUser.id, now);
}

export function resetCourseAccessSyncForTests() {
  accessSyncedAtByUser.clear();
}

/** SQL-paginated course list. Visibility and totals share one DB predicate. */
export async function listCoursesPageForUser(reqUser, { cookie, pagination } = {}) {
  if (reqUser.role === 'ADMIN') {
    await listCoursesForUser(reqUser, { cookie });
  } else {
    try {
      await syncCourseAccessMirror(reqUser, cookie);
    } catch {
      // Core-down behavior retains the owner fallback below.
      accessSyncedAtByUser.set(reqUser.id, Date.now());
    }
  }

  const authorizedUnits = reqUser.role === 'UNIT_ADMIN'
    ? await getAuthorizedUnits(reqUser, cookie)
    : [];
  const where = reqUser.role === 'ADMIN'
    ? {}
    : {
        OR: [
          {
            userId: reqUser.id,
            OR: [
              { coreCourseId: null },
              { accessGrants: { none: { userId: reqUser.id } } },
            ],
          },
          { accessGrants: { some: { userId: reqUser.id, role: 'INSTRUCTOR' } } },
          ...(reqUser.role === 'UNIT_ADMIN' && authorizedUnits.length
            ? [{ accessGrants: { some: { userId: reqUser.id, department: { in: authorizedUnits } } } }]
            : []),
        ],
      };

  const [total, rows] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.offset,
      take: pagination.limit,
      include: {
        accessGrants: {
          where: { userId: reqUser.id },
          select: { role: true, department: true },
        },
      },
    }),
  ]);

  const courses = rows.map((course) => {
    const grant = course.accessGrants?.[0];
    const accessLevel = reqUser.role === 'ADMIN'
      ? 'admin'
      : grant?.department && authorizedUnits.includes(grant.department)
        ? 'unit'
        : grant?.role === 'INSTRUCTOR' || reqUser.id === course.userId
          ? 'instructor'
          : null;
    const { accessGrants, ...plainCourse } = course;
    return { ...plainCourse, accessLevel };
  });

  let coreById = new Map();
  try {
    const coreCourses = await getCoursesByIdsFromCore(
      courses.map((course) => course.coreCourseId).filter(Boolean),
      {},
      { serviceKeyOnly: true },
    );
    coreById = new Map(coreCourses.map((course) => [course.id, course]));
  } catch {
    // Core projection degrades to the placeholder, as in the legacy list.
  }
  return { courses: courses.map((course) => enrichCourseRow(course, coreById, course.accessLevel)), total };
}

/**
 * Resolves one local row's access for `listCoursesForUser`'s non-ADMIN branch,
 * mirroring `resolveAccessForCourse`'s per-row logic without a per-row Core
 * call: `roleByCoreId` and `authorizedUnits` are pre-fetched once per request.
 *
 * `callerEnrollmentRole` comes from Core's cookie-scoped `GET /api/courses`
 * (`buildCourseListFilter`, apps/core/app/lib/auth/course-access.server.ts),
 * which derives it from the SAME `Enrollment` row `getCourseEnrollmentsFromCore`
 * would return for the caller — so the two are equivalent for any course that
 * appears in the cookie-scoped list. They diverge in exactly one case: Core's
 * enrollment branch for a STUDENT-role enrollment additionally requires
 * `isPublished: true` (an INSTRUCTOR/TA enrollment has no such gate), so a
 * caller who is a STUDENT on an unpublished course is OMITTED from the cookie
 * list entirely — `roleByCoreId.get(...)` is then `undefined` for that course,
 * same as "no enrollment". That's harmless here: this function's result is
 * only ever kept when `rank >= MIN_LIST_RANK` (instructor), and `student` is
 * rank 0 — a caller in that edge either isn't the local owner (excluded either
 * way) or is (owner-fallback below still grants instructor access), so the
 * omission never changes what `listCoursesForUser` returns.
 */
function deriveListAccess(reqUser, row, { coreById, roleByCoreId, authorizedUnits }) {
  const ownerFallback = () => (reqUser.id === row.userId ? LEVELS.instructor : null);

  // Course not yet linked to Core: no enrollment data exists (mirrors
  // resolveAccessForCourse's unlinked branch).
  if (!row.coreCourseId) return ownerFallback();

  // UNIT_ADMIN unit lock (§19): checked first, short-circuits on a match — a
  // null department is never a match. Department is read from the already-
  // fetched service-key catalog (`coreById`), so this never issues its own
  // Core call, unlike the single-course `resolveAccessForCourse` path.
  if (reqUser.role === 'UNIT_ADMIN') {
    const department = coreById.get(row.coreCourseId)?.department ?? null;
    if (department !== null && authorizedUnits.includes(department)) {
      return LEVELS.unit;
    }
    // Outside their units a UNIT_ADMIN may still hold an enrollment — fall through.
  }

  const role = roleByCoreId.get(row.coreCourseId) ?? null;
  switch (role) {
    case 'INSTRUCTOR':
      return LEVELS.instructor;
    case 'TA':
      return LEVELS.ta;
    case 'STUDENT':
      return LEVELS.student;
    default:
      // No cookie-scoped role for this course — either genuinely unenrolled,
      // or the unpublished-student edge documented above. The QM course
      // linker may also not appear in Core's roster yet right after a fresh
      // link/sync (same edge `resolveAccessForCourse` handles).
      return ownerFallback();
  }
}

/**
 * Resolves local QM `Course` rows whose Core-projected `code` matches
 * `codeQuery` (case/whitespace-insensitive). Used by the EduAI proxy routes
 * (`routes/eduai.js`) to authorize a client-supplied course code against a
 * real course — `code` is Core-owned and no longer stored locally (#1072 §4
 * step 10), so matching must read through Core rather than querying the
 * dropped `courses.code` column. One Core-side `?search=` call (#1125)
 * regardless of row count (no N+1, mirrors `listCoursesForUser`).
 *
 * Returns raw `Course` model instances (not enriched rows) so callers can
 * pass them straight to `resolveAccessForCourse`.
 */
export async function findCoursesByProjectedCode(codeQuery) {
  const target = normalizeCourseCode(codeQuery);
  if (!target) return [];

  let coreById = new Map();
  try {
    // #1125: let Core do the code match instead of pulling the catalog and
    // filtering here. The exact-match check below still applies, since Core's
    // `search` is a substring match.
    const coreCourses = await searchCoursesFromCore(target, {}, { serviceKeyOnly: true });
    coreById = new Map(coreCourses.map((c) => [c.id, c]));
  } catch {
    return []; // Core unreachable — no code-based match is possible; degrade to no access.
  }

  const allCourses = await prisma.course.findMany();
  return allCourses.filter((course) => {
    if (!course.coreCourseId) return false;
    const core = coreById.get(course.coreCourseId);
    return core?.code && normalizeCourseCode(core.code) === target;
  });
}
