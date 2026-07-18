/**
 * Role-scoped QM course listing — mirrors Core's buildCourseListFilter (§5)
 * using resolveAccessForCourse for each local QM course row.
 */
import { Course } from '../schema/index.js';
import { LEVELS, resolveAccessForCourse } from '../middleware/courseAccess.js';
import { getAllCoursesFromCore, getCourseFromCore } from './coreApiService.js';
import { dedupeCoursesByCoreId } from './courseCodeUtils.js';

const MIN_LIST_RANK = LEVELS.instructor.rank;

/** Placeholder shown when a linked course's Core row can't be resolved right now. */
const CORE_UNAVAILABLE_NAME = 'Course unavailable';

/**
 * Projects Core-owned fields (`name`, `code`, `department`, `term`, `year`,
 * `description`) onto a local QM course row (#1076/#1072 §3).
 *
 * `name`/`code` are Core-owned once a course is linked — never fall back to
 * the local column in that case, even when Core didn't resolve (that would
 * resurrect the exact staleness bug this closes). Degrade instead: a
 * placeholder name and null code (locked decision: degrade, not stale).
 *
 * Unlinked local-only rows (`coreCourseId` null — pre-sandbox-removal courses,
 * #1072 step 7) have no Core row to read through yet, so they keep their own
 * local name/code; that's not a duplicate; it's the only record that exists.
 */
function projectCoreFields(row, core) {
  const linked = Boolean(row.coreCourseId);

  if (!linked) {
    return {
      name: row.name,
      code: row.code,
      department: null,
      term: null,
      year: null,
      description: null,
      coreUnavailable: false,
    };
  }

  if (!core) {
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
 * List QM courses visible to the caller at instructor rank or above.
 * ADMIN sees all rows; UNIT_ADMIN / INSTRUCTOR are filtered via courseAccess.
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
    const enriched = allCourses.map((course) => enrichCourseRow(course, coreById, 'admin'));
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
