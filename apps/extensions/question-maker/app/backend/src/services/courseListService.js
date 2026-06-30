/**
 * Role-scoped QM course listing — mirrors Core's buildCourseListFilter (§5)
 * using resolveAccessForCourse for each local QM course row.
 */
import { Course } from '../schema/index.js';
import { LEVELS, resolveAccessForCourse } from '../middleware/courseAccess.js';
import { getAllCoursesFromCore } from './coreApiService.js';
import { dedupeCoursesByCode } from './courseCodeUtils.js';

const MIN_LIST_RANK = LEVELS.instructor.rank;

function enrichCourseRow(course, coreById, accessLevel) {
  const row = course.toJSON ? course.toJSON() : course;
  const core = row.coreCourseId ? coreById.get(row.coreCourseId) : null;
  return {
    ...row,
    department: core?.department ?? null,
    // Enrich the term/year/description from the Core course row so QM course
    // cards + detail hero can show real metadata (local rows often lack these).
    term: core?.term ?? row.term ?? null,
    year: core?.year ?? row.year ?? null,
    description: core?.description ?? row.description ?? null,
    accessLevel: accessLevel ?? null,
  };
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
    return dedupeCoursesByCode(enriched);
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
