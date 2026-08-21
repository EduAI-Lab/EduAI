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
/** Roles AI Tutor understands on a course surface. */
export function isSupportedCourseRole(role) {
  return (
    role === "STUDENT" ||
    role === "INSTRUCTOR" ||
    role === "TA" ||
    role === "ADMIN" ||
    role === "UNIT_ADMIN"
  );
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
 *   taCoreIdSet: Set<string>, // courses held under TA role (no progress)
 *   hasProgress: boolean,      // whether any returned row carries `progress`
 * }>}
 */
export async function resolveCourseAccess(
  authUser,
  { catalogCourses, publishedCoreIds, callerCourses = [] },
) {
  if (authUser.role === "ADMIN") {
    // Platform admins see Core's full course catalog (#1074) — no local scoping.
    return {
      kind: "admin",
      where: undefined,
      isEmpty: false,
      taCoreIdSet: new Set(),
      hasProgress: false,
    };
  }

  if (authUser.role === "INSTRUCTOR") {
    const taughtCoreIds = callerCourses
      .filter((course) => course?.callerEnrollmentRole === "INSTRUCTOR")
      .map((course) => course.id);
    return {
      kind: "instructor",
      where: { coreOfferingId: { in: taughtCoreIds } },
      isEmpty: taughtCoreIds.length === 0,
      taCoreIdSet: new Set(),
      hasProgress: false,
    };
  }

  if (authUser.role === "UNIT_ADMIN") {
    // UNIT_ADMINs see every course in their authorized units (regardless of
    // publish state), plus courses where Core's live caller snapshot says they
    // are an instructor. Never union stale local instructor assignments into
    // this live scope.
    // `department` is Core-owned (#1072 step 4): join the already-fetched
    // service-key catalog batch (never a per-course Core call) to find which
    // `coreOfferingId`s fall in the caller's units, then scope the local query
    // on that id set unioned with instructor membership. Fail-soft: on
    // `coreUnavailable` the department set is empty, so the branch degrades to
    // "courses I personally lead" rather than erroring.
    const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
    const deptCoreIds =
      units.length > 0
        ? catalogCourses
            .filter((c) => c?.department && units.includes(c.department))
            .map((c) => c.id)
        : [];
    const taughtCoreIds = callerCourses
      .filter((course) => course?.callerEnrollmentRole === "INSTRUCTOR")
      .map((course) => course.id);
    const visibleCoreIds = [...new Set([...deptCoreIds, ...taughtCoreIds])];
    return {
      kind: "unitAdmin",
      where: { coreOfferingId: { in: visibleCoreIds } },
      isEmpty: visibleCoreIds.length === 0,
      taCoreIdSet: new Set(),
      hasProgress: false,
    };
  }

  const taCoreIds = callerCourses
    .filter((course) => course?.callerEnrollmentRole === "TA")
    .map((course) => course.id);
  const instructorCoreIds = callerCourses
    .filter((course) => course?.callerEnrollmentRole === "INSTRUCTOR")
    .map((course) => course.id);
  const studentCoreIds = callerCourses
    .filter((course) => course?.callerEnrollmentRole === "STUDENT")
    .map((course) => course.id);

  if (
    authUser.role === "TA" ||
    (authUser.role === "STUDENT" && (taCoreIds.length > 0 || instructorCoreIds.length > 0))
  ) {
    // TAs see all TA-enrolled courses regardless of publish state (no progress),
    // plus published student-enrolled courses (with progress). The publish gate
    // reads through Core (#819) rather than the possibly-stale local column,
    // same as the STUDENT branch below.
    // #1043/#1386: live TA/instructor courses (any publish state, no progress)
    // UNION live student-enrolled *published* courses (with progress). Core's
    // caller snapshot, rather than local mirror rows, is authoritative for all
    // three roles. Elevated standing wins when a course is held under both it
    // and a student enrollment.
    const noProgressCoreIds = [...new Set([...taCoreIds, ...instructorCoreIds])];
    const OR = [
      ...(noProgressCoreIds.length > 0 ? [{ coreOfferingId: { in: noProgressCoreIds } }] : []),
      ...(studentCoreIds.length > 0
        ? [{ coreOfferingId: { in: studentCoreIds.filter((id) => publishedCoreIds.includes(id)) } }]
        : []),
    ];

    return {
      kind: "taUnion",
      where: { OR },
      isEmpty: OR.length === 0,
      taCoreIdSet: new Set(noProgressCoreIds),
      hasProgress: studentCoreIds.length > 0,
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
    kind: "student",
    where: {
      coreOfferingId: {
        in: studentCoreIds.filter((id) => publishedCoreIds.includes(id)),
      },
    },
    isEmpty: studentCoreIds.length === 0,
    taCoreIdSet: new Set(),
    hasProgress: true,
  };
}
