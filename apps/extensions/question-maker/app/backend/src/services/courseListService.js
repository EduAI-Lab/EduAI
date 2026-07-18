/**
 * Role-scoped QM course listing — mirrors Core's buildCourseListFilter (§5)
 * using resolveAccessForCourse for each local QM course row.
 */
import { Course } from '../schema/index.js';
import { LEVELS, resolveAccessForCourse } from '../middleware/courseAccess.js';
import { getAllCoursesFromCore, getCourseFromCore } from './coreApiService.js';
import { dedupeCoursesByCoreId, normalizeCourseCode } from './courseCodeUtils.js';

const MIN_LIST_RANK = LEVELS.instructor.rank;

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
    coreUnavailable: false,
  };
}

/** Batched-list variant: `core` is looked up from a pre-fetched `coreById` map. */
function enrichCourseRow(course, coreById, accessLevel) {
  const row = course.toJSON ? course.toJSON() : course;
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
  const row = course.toJSON ? course.toJSON() : course;

  let core = null;
  if (row.coreCourseId) {
    try {
      core = await getCourseFromCore(row.coreCourseId, { cookie });
    } catch {
      core = null; // Core unreachable — degrade the detail response, don't hard-error.
    }
  }

  return { ...row, ...projectCoreFields(row, core) };
}

/**
 * Batched read-through for arrays of rows carrying a nested `course` object
 * (question/assessment lists, e.g. `getQuestionsByUser`/`getAssessmentsByUser`).
 * ONE `getAllCoursesFromCore` call regardless of row count — never a per-row
 * Core fetch (locked decision: no N+1) — mirroring `listCoursesForUser`.
 * Rows without a `course` field (or whose nested course lacks `coreCourseId`
 * in its `attributes`) pass through unchanged.
 */
export async function enrichRowsWithCourse(rows) {
  let coreById = new Map();
  try {
    const coreCourses = await getAllCoursesFromCore();
    coreById = new Map(coreCourses.map((c) => [c.id, c]));
  } catch {
    // Core unreachable — rows still return; nested course degrades to placeholder.
  }

  return rows.map((row) => {
    const plain = row.toJSON ? row.toJSON() : row;
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
  const plain = row.toJSON ? row.toJSON() : row;
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
  const course = await Course.findByPk(courseId, { attributes: ['id', 'coreCourseId'] });
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
  const allCourses = await Course.findAll({ order: [['createdAt', 'DESC']] });

  let coreById = new Map();
  try {
    const coreCourses = await getAllCoursesFromCore();
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
    // — no extra findAll. One bulkCreate for the missing set, idempotent via
    // `ignoreDuplicates` (Postgres ON CONFLICT DO NOTHING on the unique
    // `core_course_id` index) so concurrent admin requests racing to
    // materialize the same course never error. Core unreachable ⇒ coreById is
    // empty ⇒ nothing to materialize ⇒ falls through to the existing local
    // rows with placeholder projection (degrade, not error).
    const existingCoreCourseIds = new Set(
      allCourses.map((c) => (c.toJSON ? c.toJSON() : c).coreCourseId).filter(Boolean),
    );
    const missingCoreCourseIds = Array.from(coreById.keys()).filter(
      (id) => !existingCoreCourseIds.has(id),
    );

    let adminCourses = allCourses;
    if (missingCoreCourseIds.length > 0) {
      await Course.bulkCreate(
        missingCoreCourseIds.map((coreCourseId) => ({ userId: reqUser.id, coreCourseId })),
        { ignoreDuplicates: true },
      );
      // Re-fetch: bulkCreate's returned instances aren't reliable under
      // ON CONFLICT DO NOTHING, and a racing request may have inserted some
      // of these rows first — read back the ground truth.
      adminCourses = await Course.findAll({ order: [['createdAt', 'DESC']] });
    }

    // Catalog-sourced dedupe: an existing local anchor and a freshly
    // materialized one can both resolve to the same Core course; merge them
    // on Core identity same as before.
    const enriched = adminCourses.map((course) => enrichCourseRow(course, coreById, 'admin'));
    return dedupeCoursesByCoreId(enriched);
  }

  const visible = [];
  for (const course of allCourses) {
    const access = await resolveAccessForCourse(reqUser, course, { cookie });
    if (access && access.rank >= MIN_LIST_RANK) {
      visible.push(enrichCourseRow(course, coreById, access.level));
    }
  }
  return visible;
}

/**
 * Resolves local QM `Course` rows whose Core-projected `code` matches
 * `codeQuery` (case/whitespace-insensitive). Used by the EduAI proxy routes
 * (`routes/eduai.js`) to authorize a client-supplied course code against a
 * real course — `code` is Core-owned and no longer stored locally (#1072 §4
 * step 10), so matching must read through Core rather than querying the
 * dropped `courses.code` column. One batched `getAllCoursesFromCore` call
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
    const coreCourses = await getAllCoursesFromCore();
    coreById = new Map(coreCourses.map((c) => [c.id, c]));
  } catch {
    return []; // Core unreachable — no code-based match is possible; degrade to no access.
  }

  const allCourses = await Course.findAll();
  return allCourses.filter((course) => {
    if (!course.coreCourseId) return false;
    const core = coreById.get(course.coreCourseId);
    return core?.code && normalizeCourseCode(core.code) === target;
  });
}
