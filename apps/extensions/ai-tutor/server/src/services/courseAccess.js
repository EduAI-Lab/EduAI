/**
 * @file Role → course-visibility resolution for the course list surfaces.
 *
 * Responsibility: Owns the single definition of "which CourseOfferings may this
 *   caller see", as a Prisma `where` fragment plus the metadata the caller needs
 *   to shape the response (which rows carry progress, whether the set is empty
 *   by construction).
 * Callers: `GET /api/courses` and `GET /api/courses/facets` (#1208). Both must
 *   agree exactly — a facet value the list can never return would offer the user
 *   a filter that always yields nothing.
 * Gotchas:
 *   - Extracted verbatim from the `GET /courses` role branches (#1043/#1072/#819)
 *     with NO behaviour change, so the existing route tests pin it. Read the
 *     branch comments below before altering any predicate — several encode
 *     fail-closed publish semantics that look redundant but are not.
 *   - Branch order matters and is not role-precedence: a STUDENT holding any TA
 *     enrollment resolves to `taUnion`, not `student`.
 *   - `publishedCoreIds` is derived from the Core catalog, which is empty when
 *     Core is unavailable. That makes the student/TA publish gate `{ in: [] }` →
 *     no rows. This is deliberate fail-closed behaviour, not a bug to "fix".
 * Related: routes/courses.js, services/courseResolver.js, utils/courseSearch.js
 */
import { prisma } from '../config/database.js';

/** Roles AI Tutor understands on a course surface. */
export function isSupportedCourseRole(role) {
  return role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'TA' || role === 'ADMIN'
    || role === 'UNIT_ADMIN';
}

/** True when the user holds a TA enrollment on any course. */
export async function userHasTaEnrollment(userId) {
  const count = await prisma.courseEnrollment.count({
    where: { userId, role: 'TA' },
  });
  return count > 0;
}

/**
 * True when the user is instructor-of-record (a `CourseInstructor` row) on
 * any course. #1386: a platform STUDENT who is also instructor-of-record on
 * a course must see it the same way Core does (enrollment-role keyed, not
 * platform-role keyed) — this lets the STUDENT branch fold those courses in
 * the same way it already does for a held TA enrollment.
 */
export async function userHasInstructorOfRecordStatus(userId) {
  const count = await prisma.courseInstructor.count({ where: { userId } });
  return count > 0;
}

/**
 * Resolve the caller's course visibility.
 *
 * @param {{ id: string, role: string, authorizedUnits?: string[] }} authUser
 * @param {{ catalogCourses: Array<object>, publishedCoreIds: string[] }} ctx
 * @returns {Promise<{
 *   kind: 'admin'|'instructor'|'unitAdmin'|'taUnion'|'student',
 *   where: object|undefined,   // undefined = unrestricted (ADMIN)
 *   isEmpty: boolean,          // true = caller can see nothing; skip the query
 *   taOfferingIdSet: Set<number>, // courses held under TA role (no progress)
 *   hasProgress: boolean,      // whether any returned row carries `progress`
 * }>}
 */
export async function resolveCourseAccess(authUser, { catalogCourses, publishedCoreIds }) {
  if (authUser.role === 'ADMIN') {
    // Platform admins see Core's full course catalog (#1074) — no local scoping.
    return {
      kind: 'admin',
      where: undefined,
      isEmpty: false,
      taOfferingIdSet: new Set(),
      hasProgress: false,
    };
  }

  if (authUser.role === 'INSTRUCTOR') {
    return {
      kind: 'instructor',
      where: { instructors: { some: { userId: authUser.id } } },
      isEmpty: false,
      taOfferingIdSet: new Set(),
      hasProgress: false,
    };
  }

  if (authUser.role === 'UNIT_ADMIN') {
    // UNIT_ADMINs see every course in their authorized units (regardless of
    // publish state), plus any course they personally lead — so the courses
    // they create or import are always visible even before a department is set.
    // `department` is Core-owned (#1072 step 4): join the already-fetched
    // service-key catalog batch (never a per-course Core call) to find which
    // `coreOfferingId`s fall in the caller's units, then scope the local query
    // on that id set unioned with instructor membership. Fail-soft: on
    // `coreUnavailable` the department set is empty, so the branch degrades to
    // "courses I personally lead" rather than erroring.
    const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
    const deptCoreIds = units.length > 0
      ? catalogCourses.filter((c) => c?.department && units.includes(c.department)).map((c) => c.id)
      : [];
    return {
      kind: 'unitAdmin',
      where: {
        OR: [
          ...(deptCoreIds.length > 0 ? [{ coreOfferingId: { in: deptCoreIds } }] : []),
          { instructors: { some: { userId: authUser.id } } },
        ],
      },
      isEmpty: false,
      taOfferingIdSet: new Set(),
      hasProgress: false,
    };
  }

  const isStudentWithElevatedStanding = authUser.role === 'STUDENT'
    && (await userHasTaEnrollment(authUser.id) || await userHasInstructorOfRecordStatus(authUser.id));

  if (authUser.role === 'TA' || isStudentWithElevatedStanding) {
    // TAs see all TA-enrolled courses regardless of publish state (no progress),
    // plus published student-enrolled courses (with progress). The publish gate
    // reads through Core (#819) rather than the possibly-stale local column,
    // same as the STUDENT branch below. #1386: a STUDENT who is also
    // instructor-of-record (a CourseInstructor row) on a course gets the same
    // any-publish-state, no-progress treatment as a TA enrollment — Core's
    // enrollment-role fallback (rbac-matrix.md §3) makes no platform-role
    // distinction here, so ai-tutor's STUDENT fork shouldn't either.
    const [allEnrollments, instructorRows] = await Promise.all([
      prisma.courseEnrollment.findMany({
        where: { userId: authUser.id },
        select: { courseOfferingId: true, role: true },
      }),
      prisma.courseInstructor.findMany({
        where: { userId: authUser.id },
        select: { courseOfferingId: true },
      }),
    ]);
    const taOfferingIds = allEnrollments
      .filter((e) => e.role === 'TA')
      .map((e) => e.courseOfferingId);
    const instructorOfferingIds = instructorRows.map((r) => r.courseOfferingId);
    const studentOfferingIds = allEnrollments
      .filter((e) => e.role === 'STUDENT')
      .map((e) => e.courseOfferingId);

    // #1043/#1386: TA-enrolled + instructor-of-record courses (any publish
    // state, no progress) UNION student-enrolled *published* courses (with
    // progress) — collapsed into one query so the page and `total` are honest
    // across the join. The published gate rides in the SQL `where`
    // (publishedCoreIds), and progress is attached only to the student-role
    // rows on the returned page. TA/instructor-of-record standing wins when a
    // course is held under both that and a student enrollment.
    const noProgressOfferingIds = [...new Set([...taOfferingIds, ...instructorOfferingIds])];
    const OR = [
      ...(noProgressOfferingIds.length > 0 ? [{ id: { in: noProgressOfferingIds } }] : []),
      ...(studentOfferingIds.length > 0
        ? [{ id: { in: studentOfferingIds }, coreOfferingId: { in: publishedCoreIds } }]
        : []),
    ];

    return {
      kind: 'taUnion',
      where: { OR },
      isEmpty: OR.length === 0,
      taOfferingIdSet: new Set(noProgressOfferingIds),
      hasProgress: studentOfferingIds.length > 0,
    };
  }

  // Students only see published courses they're enrolled in (with progress).
  // The publish gate reads through Core (#819) rather than the possibly-stale
  // local column — a course published in Core but not yet reconciled locally
  // must still appear here. #1082 stays fixed by construction: the catalog
  // contains every non-deleted Core course, so an AT-only enrollment (no
  // matching Core enrollment) still resolves its fields and publish state here.
  // #1043: the `.filter(isCorePublished)` post-query gate is now the
  // `coreOfferingId in publishedCoreIds` SQL predicate, so skip/take and `total`
  // are honest.
  return {
    kind: 'student',
    where: {
      enrollments: { some: { userId: authUser.id } },
      coreOfferingId: { in: publishedCoreIds },
    },
    isEmpty: false,
    taOfferingIdSet: new Set(),
    hasProgress: true,
  };
}
