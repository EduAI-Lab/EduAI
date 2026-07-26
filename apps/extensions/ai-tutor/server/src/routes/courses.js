/**
 * @file Course offering listing, creation, EduAI import, content cloning, and
 *       publish/unpublish workflow.
 *
 * Responsibility: Owns the CourseOffering top-level lifecycle: instructor
 *   creates/imports/clones courses; students see only published ones with
 *   their progress.
 * Callers: Mounted under `/api`; consumed by the home, instructor, and student
 *   list pages plus the course-import dialogs.
 * Gotchas:
 *   - Listing is role-divergent: INSTRUCTOR sees all assigned courses regardless
 *     of publish state; STUDENT only sees published courses they're enrolled
 *     in, with progress computed per course (N+1 by design — kept here, may
 *     warrant batching if course counts grow). The publish gate itself is
 *     read-through from Core (`resolveIsPublished`, #1072 step 2 / #819) —
 *     one batched `GET /api/courses` per request, not per-course.
 *   - Unified contract (#1072): field/publish resolution uses ONE service-key
 *     catalog fetch (`resolveCoreCourseCatalog`) — complete regardless of the
 *     caller's Core enrollment (AT and Core enrollment are independent
 *     tracks, so the cookie-scoped list is not a valid field source). The
 *     cookie-scoped list is only fetched inside the throttled fire-and-forget
 *     auto-import mirror (`runCoreMirror`), which consumes
 *     `callerEnrollmentRole` — authorization context. The list response
 *     itself performs exactly ONE Core call (the catalog).
 *   - Course-owned fields (title/description/department/dates/isPublished/
 *     term/year/aiInstructions) are read-through from Core via
 *     `services/courseResolver.js` + `mapCourseOffering`; the local
 *     `CourseOffering` row is a pure anchor (#1072 step 4 — id,
 *     `coreOfferingId`, timestamps only, no Core-owned columns). A Core
 *     outage degrades those fields to `null`/`false` rather than a stale
 *     local copy. See `courseResolver.js` for the fail-soft contract.
 *   - UNIT_ADMIN department scoping (`isUnitAdminForCourse`/`isCourseAdmin`
 *     in `middleware/auth.js`) also resolves `department` live from Core —
 *     there is no local column to filter/read anymore.
 *   - Importing from EduAI fans out into parallel topic + enrollment sync via
 *     `Promise.allSettled` so a partial upstream failure doesn't roll back the
 *     import itself; failures are logged.
 *   - Publish has no cascading; unpublish CASCADES to all child modules and
 *     lessons in a transaction so a student can never reach orphaned content.
 *   - `POST /courses` accepts an optional `sourceCourseId` to deep-clone
 *     content from another course the same instructor owns.
 * Related: services/eduaiClient.js, services/topicSync.js,
 *   services/enrollmentSync.js, services/courseCloning.js,
 *   services/progressCalculation.js
 */

import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isUnitAdminForCourse, isCourseAdmin } from '../middleware/auth.js';
import { mapCourseOffering, mapProgressData } from '../utils/mappers.js';
import { parsePaginationParams, paginated, PaginationError } from '../utils/pagination.js';
import { cloneCourseContent, cloneLessonsFromOffering } from '../services/courseCloning.js';
import { calculateCourseProgress } from '../services/progressCalculation.js';
import {
  findEduAiCourseById,
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  listEduAiCourses,
  setCoreCoursePublishState,
} from '../services/eduaiClient.js';
import {
  indexCoreCoursesById,
  resolveCoreCourseById,
  resolveCoreCourseCatalog,
  resolveIsPublished,
} from '../services/courseResolver.js';
import { mapEduAiServiceKeyError } from '../services/eduaiServiceKeyErrors.js';
import { getEduAiCookieForRequest } from '../services/eduaiAuth.js';
import { syncCourseEnrollments } from '../services/enrollmentSync.js';
import {
  ensureOfferingAnchors,
  importExternalCourseForUser,
  runCoreMirror,
} from '../services/importTaughtCoursesService.js';
import { listAdminBugReports } from '../services/bugReports.js';

const router = express.Router();

function isSupportedCourseRole(role) {
  return (
    role === 'INSTRUCTOR' ||
    role === 'STUDENT' ||
    role === 'TA' ||
    role === 'UNIT_ADMIN' ||
    role === 'ADMIN'
  );
}

async function userHasTaEnrollment(userId) {
  const count = await prisma.courseEnrollment.count({
    where: { userId, role: 'TA' },
  });
  return count > 0;
}

/**
 * Pull the MCQ option labels out of a freeform `Activity.config`. Mirrors the
 * `options` normalization in `mapActivity` — accepts the modern
 * `{ options: { choices: [] } }` shape and the legacy bare-array form. Returns
 * `null` when the activity carries no choices (e.g. short-answer questions).
 */
function extractChoices(config) {
  if (!config || typeof config !== 'object') return null;
  const { options } = config;
  if (options == null) return null;
  if (Array.isArray(options)) return options;
  if (Array.isArray(options.choices)) return options.choices;
  return null;
}

function respondEduAiUpstreamError(res, error, fallbackMessage) {
  const mapped = mapEduAiServiceKeyError(error);
  if (mapped) {
    return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
  const status = Number.isInteger(error?.status) ? error.status : 502;
  return res.status(status).json({ error: error.message || fallbackMessage });
}

/**
 * GET /eduai/courses — list importable EduAI courses for the instructor.
 *
 * Auth: INSTRUCTOR.
 * Returns: EduAI course descriptors minus any already imported by this
 *   instructor (de-duped via local `coreOfferingId`).
 *
 * Why: filtering by THIS instructor (not globally) lets multiple instructors
 * import the same EduAI course independently into their own offerings.
 */
router.get('/eduai/courses', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    // #578: list the caller's Core-scoped courses using their session cookie
    // (the service key would return the full catalog). Mirrors the import path.
    // #1041: Core pages this endpoint, and the already-imported filter below
    // needs the caller's complete set, so walk every page.
    const courses = await listEduAiCourses({ cookie: req.headers.cookie, all: true });

    // Exclude any Core course already mirrored into AI Tutor. coreOfferingId is
    // required + @unique (#1072 step 4 — every row is Core-linked, no filter
    // needed), so a hit there means the course is already in the system.
    const imported = await prisma.courseOffering.findMany({
      select: { coreOfferingId: true },
    });

    const importedIds = new Set(imported.map((row) => row.coreOfferingId).filter(Boolean));
    const filtered = Array.isArray(courses)
      ? courses.filter((c) => c && typeof c.id === 'string' && !importedIds.has(c.id))
      : [];

    res.json(filtered);
  } catch (error) {
    console.error('[eduai] Failed to list courses', error);
    return respondEduAiUpstreamError(res, error, 'Unable to fetch EduAI courses');
  }
});

/**
 * GET /courses — list courses for the current user.
 *
 * Auth: INSTRUCTOR or STUDENT.
 * Returns: INSTRUCTOR → all instructor-assigned courses (no progress);
 *   STUDENT → published enrolled courses each with `progress`.
 *
 * Why: the two roles want fundamentally different shapes, so progress
 * computation is skipped entirely for instructors to keep their dashboard fast.
 */
router.get('/courses', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
  }

  const cookie = getEduAiCookieForRequest(req);

  try {
    // #1043: unbounded list — require explicit paging (Group A contract,
    // mirrors #1041). One envelope shape across every role branch below.
    const pageParams = parsePaginationParams(req);

    // Unified extension course-fetch contract (#1072): course FIELD truth
    // comes from ONE batched service-key catalog fetch — never the
    // cookie-scoped list, whose contents depend on the caller's Core
    // enrollment (AT and Core enrollment are independent tracks). The
    // cookie-scoped list is fetched separately below, ONLY in branches that
    // run the auto-import mirrors (they consume `callerEnrollmentRole` —
    // authorization context, not fields). At most 2 Core calls per request.
    // On catalog failure this degrades to an empty Core map (fields null,
    // publish gates fail closed) plus an `X-Core-Status` header the client
    // can render (see #1066's topic fail-soft pattern) — never a hard error.
    const { courses: catalogCourses, coreUnavailable } = await resolveCoreCourseCatalog();
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }
    const withCore = (offering) => mapCourseOffering(offering, coreCoursesById.get(offering.coreOfferingId));

    // #1043: the student/TA publish gate was a post-query `.filter(isCorePublished)`,
    // which makes skip/take and `total` lie (a page could be mostly unpublished).
    // resolveIsPublished is purely `catalog.get(coreOfferingId)?.isPublished === true`
    // (no local column since #1072), and the catalog is already fully page-walked
    // above — so we can push the exact same gate into the SQL `where` as an id set.
    // Fail-closed is preserved: on `coreUnavailable` this list is empty, so the
    // filter yields `{ in: [] }` → no rows, matching the old behaviour.
    const publishedCoreIds = catalogCourses
      .filter((c) => c?.isPublished === true)
      .map((c) => c.id);

    if (authUser.role === 'STUDENT' || authUser.role === 'TA') {
      // Unified contract: the mirror is a throttled fire-and-forget side
      // effect (shared runCoreMirror) — the list response never waits on it.
      // It fetches its own cookie-scoped list internally (authorization
      // context / callerEnrollmentRole); a fresh Core enrollment shows up on
      // the caller's next request, same trade-off as QM's list mirror.
      runCoreMirror(authUser, cookie);
    }

    if (authUser.role === 'ADMIN') {
      // Platform admins see Core's full course catalog (#1074), not just
      // whatever happened to already have a local anchor row — the old
      // enrollment-driven mirror never ran for admins (no enrollments of
      // their own), so it silently showed a stale/incomplete subset.
      // Create-on-open (#1072 step 3): ensure every Core course has a local
      // anchor *before* listing, in one batched read + insert (never a
      // per-course loop) — this is what lets the response link to a real,
      // stable local id for a course no instructor has ever logged in to
      // auto-import. Fields are read-through from Core above. The anchor id
      // set comes from the service-key catalog — identical to what Core's
      // admin-to-all cookie branch used to return, without needing a cookie
      // call in this branch at all.
      if (!coreUnavailable && catalogCourses.length > 0) {
        await ensureOfferingAnchors(catalogCourses.map((c) => c.id));
      }
      const [total, courses] = await prisma.$transaction([
        prisma.courseOffering.count(),
        prisma.courseOffering.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pageParams.skip,
          take: pageParams.take,
        }),
      ]);
      res.json(paginated(courses.map(withCore), total, pageParams));
    } else if (authUser.role === 'INSTRUCTOR') {
      // Unified contract: throttled fire-and-forget mirror (see STUDENT/TA
      // branch note above) — a course newly assigned in Core appears on the
      // instructor's next request rather than blocking this one.
      runCoreMirror(authUser, cookie);

      const instructorWhere = { instructors: { some: { userId: authUser.id } } };
      const [total, courses] = await prisma.$transaction([
        prisma.courseOffering.count({ where: instructorWhere }),
        prisma.courseOffering.findMany({
          where: instructorWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pageParams.skip,
          take: pageParams.take,
        }),
      ]);
      res.json(paginated(courses.map(withCore), total, pageParams));
    } else if (authUser.role === 'UNIT_ADMIN') {
      // UNIT_ADMINs see every course in their authorized units (regardless of
      // publish state), plus any course they personally lead — so the courses
      // they create or import are always visible even before a department is set.
      // `department` is Core-owned (#1072 step 4): join the already-fetched
      // service-key catalog batch (never a per-course Core call) to find which
      // `coreOfferingId`s fall in the caller's units, then scope the local
      // query on that id set unioned with instructor membership. Fail-soft:
      // on `coreUnavailable` the department set is empty, so the branch
      // degrades to "courses I personally lead" rather than erroring.
      const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
      const deptCoreIds = units.length > 0
        ? catalogCourses.filter((c) => c?.department && units.includes(c.department)).map((c) => c.id)
        : [];
      const unitAdminWhere = {
        OR: [
          ...(deptCoreIds.length > 0 ? [{ coreOfferingId: { in: deptCoreIds } }] : []),
          { instructors: { some: { userId: authUser.id } } },
        ],
      };
      const [total, courses] = await prisma.$transaction([
        prisma.courseOffering.count({ where: unitAdminWhere }),
        prisma.courseOffering.findMany({
          where: unitAdminWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pageParams.skip,
          take: pageParams.take,
        }),
      ]);
      res.json(paginated(courses.map(withCore), total, pageParams));
    } else if (authUser.role === 'TA' || (authUser.role === 'STUDENT' && await userHasTaEnrollment(authUser.id))) {
      // TAs see all TA-enrolled courses regardless of publish state (no progress),
      // plus published student-enrolled courses (with progress). The publish
      // gate reads through Core (#819) rather than the possibly-stale local
      // column, same as the STUDENT branch below.
      const allEnrollments = await prisma.courseEnrollment.findMany({
        where: { userId: authUser.id },
        select: { courseOfferingId: true, role: true },
      });
      const taOfferingIds = allEnrollments
        .filter((e) => e.role === 'TA')
        .map((e) => e.courseOfferingId);
      const studentOfferingIds = allEnrollments
        .filter((e) => e.role === 'STUDENT')
        .map((e) => e.courseOfferingId);
      const taOfferingIdSet = new Set(taOfferingIds);

      // #1043: TA-enrolled courses (any publish state, no progress) UNION
      // student-enrolled *published* courses (with progress) — collapsed into
      // one query so the page and `total` are honest across the join. The
      // published gate rides in the SQL `where` (publishedCoreIds), and progress
      // is attached only to the student-role rows on the returned page. TA
      // enrollment wins when a course is held under both roles.
      const taUnionWhere = {
        OR: [
          ...(taOfferingIds.length > 0 ? [{ id: { in: taOfferingIds } }] : []),
          ...(studentOfferingIds.length > 0
            ? [{ id: { in: studentOfferingIds }, coreOfferingId: { in: publishedCoreIds } }]
            : []),
        ],
      };

      if (taUnionWhere.OR.length === 0) {
        return res.json(paginated([], 0, pageParams));
      }

      const [total, courses] = await prisma.$transaction([
        prisma.courseOffering.count({ where: taUnionWhere }),
        prisma.courseOffering.findMany({
          where: taUnionWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pageParams.skip,
          take: pageParams.take,
        }),
      ]);

      const rows = await Promise.all(
        courses.map(async (course) => {
          if (taOfferingIdSet.has(course.id)) {
            return withCore(course);
          }
          const progress = await calculateCourseProgress(course.id, authUser.id);
          return { ...withCore(course), progress: mapProgressData(progress) };
        }),
      );

      res.json(paginated(rows, total, pageParams));
    } else {
      // Students only see published courses they're enrolled in (with
      // progress). The publish gate reads through Core (#819) rather than
      // the possibly-stale local column — a course published in Core but not
      // yet reconciled locally must still appear here.
      // #1082 stays fixed by construction: the catalog contains every
      // non-deleted Core course, so an AT-only enrollment (no matching Core
      // enrollment) still resolves its fields and publish state here.
      // #1043: the `.filter(isCorePublished)` post-query gate is now the
      // `coreOfferingId in publishedCoreIds` SQL predicate, so skip/take and
      // `total` are honest.
      const studentWhere = {
        enrollments: { some: { userId: authUser.id } },
        coreOfferingId: { in: publishedCoreIds },
      };
      const [total, courses] = await prisma.$transaction([
        prisma.courseOffering.count({ where: studentWhere }),
        prisma.courseOffering.findMany({
          where: studentWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pageParams.skip,
          take: pageParams.take,
        }),
      ]);

      // Calculate progress for each course on the page
      const coursesWithProgress = await Promise.all(
        courses.map(async (course) => {
          const progress = await calculateCourseProgress(course.id, authUser.id);
          return {
            ...withCore(course),
            progress: mapProgressData(progress),
          };
        }),
      );

      res.json(paginated(coursesWithProgress, total, pageParams));
    }
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses/import-external — create a CourseOffering mirroring an EduAI course.
 *
 * Auth: INSTRUCTOR.
 * Side effects: creates CourseOffering + CourseInstructor inside a transaction,
 *   then fans out parallel topic + enrollment sync to EduAI; returns 409 if the
 *   instructor has already imported this externalCourseId.
 *
 * Why: post-create syncs run via `Promise.allSettled` so a flaky upstream call
 * for one of {topics, enrollments} doesn't block the other or roll back the
 * import. The instructor can rerun sync explicitly afterwards.
 */
router.post('/courses/import-external', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const instructor = req.user;
  const { externalCourseId } = req.body || {};

  if (!externalCourseId || typeof externalCourseId !== 'string') {
    return res.status(400).json({ error: 'externalCourseId is required' });
  }

  try {
    // #578: only courses in the instructor's Core-scoped list are importable.
    // A miss means the caller is not authorized for this Core course (not a 404).
    const externalCourse = await findEduAiCourseById(externalCourseId, { cookie: req.headers.cookie });
    if (!externalCourse) {
      return res.status(403).json({ error: 'CORE_COURSE_NOT_AUTHORIZED' });
    }

    // coreOfferingId is @unique — one AI Tutor offering per Core course
    // regardless of instructor. Import is an idempotent ENSURE (unified
    // contract): the throttled background mirror may have anchored this
    // course between the caller's list and this request, so "already
    // imported" is a success (200 with the existing row, instructor linkage
    // ensured by the service), not a conflict.
    const { offering, created } = await importExternalCourseForUser(instructor, externalCourse);

    // `externalCourse` is already the resolved Core course for this offering
    // (just fetched above) — pass it straight through rather than issuing a
    // second Core call.
    res.status(created ? 201 : 200).json(mapCourseOffering(offering, externalCourse));
  } catch (error) {
    console.error('[eduai] Failed to import course', error);
    return respondEduAiUpstreamError(res, error, 'Unable to import course');
  }
});

/**
 * POST /courses/:courseId/sync-enrollments — refresh student enrollments from Core (#578).
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin).
 * Only EduAI-imported courses can sync; a native course has no Core roster to
 * pull from, so it returns 400 rather than a misleading empty sync.
 */
router.post('/courses/:courseId/sync-enrollments', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!await isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }
    if (!course.coreOfferingId) {
      return res.status(400).json({ error: 'Course was not imported from EduAI' });
    }

    const result = await syncCourseEnrollments(courseId, { course });
    res.json(result);
  } catch (error) {
    console.error('[eduai] Failed to sync enrollments', error);
    return respondEduAiUpstreamError(res, error, 'Unable to sync enrollments');
  }
});

router.get('/courses/:courseId', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: 'Role is not supported in AI Tutor' });
  }

  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // #1072 step 2/4: single-course read-through, resolved once and reused
    // for both the UNIT_ADMIN department check below and the response body
    // — `department` is Core-owned data, not a local column. Degrades to a
    // stale-but-present course (and a closed unit-admin department check) on
    // any Core failure rather than hard-erroring.
    const { course: coreCourse, coreUnavailable } = await resolveCoreCourseById(course.coreOfferingId);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }

    const isAdmin = authUser.role === 'ADMIN';
    const isInstructor = course.instructors.some((i) => i.userId === authUser.id);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const unitAdmin = await isUnitAdminForCourse(authUser, course, coreCourse);
    const isMember = isAdmin || isInstructor || enrollment != null || unitAdmin;

    if (!isMember) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    res.json(mapCourseOffering(course, coreCourse));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /courses — deprecated (#632). Course creation is owned by EduAI Core.
 * Always returns 403 so legacy clients cannot create offerings locally.
 */
router.post('/courses', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (_req, res) => {
  return res.status(403).json({
    error:
      'Course creation is managed in EduAI Core. Import or enable courses from Core instead.',
  });
});

/**
 * POST /courses/:courseId/import — selectively clone modules or lessons into
 * an existing course.
 *
 * Auth: INSTRUCTOR on both source and destination courses.
 * Body: either `{ sourceCourseId, moduleIds }` to clone whole modules, or
 *   `{ lessonIds, targetModuleId }` to clone individual lessons into a chosen
 *   destination module.
 * Side effects: deep-copies via `cloneCourseContent` / `cloneLessonsFromOffering`.
 *
 * Why: lesson-level imports require an explicit `targetModuleId` because
 * lessons have no implicit destination, whereas module-level imports preserve
 * their structure.
 */
router.post('/courses/:courseId/import', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  const { sourceCourseId, moduleIds, lessonIds, targetModuleId } = req.body || {};

  const normalizedModuleIds = Array.isArray(moduleIds)
    ? moduleIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  const normalizedLessonIds = Array.isArray(lessonIds)
    ? lessonIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  const numericTargetModuleId =
    typeof targetModuleId === 'number' || typeof targetModuleId === 'string'
      ? Number(targetModuleId)
      : null;

  const numericSourceCourseId =
    typeof sourceCourseId === 'number' || typeof sourceCourseId === 'string'
      ? Number(sourceCourseId)
      : null;

  if (numericSourceCourseId !== null && !Number.isFinite(numericSourceCourseId)) {
    return res.status(400).json({ error: 'Invalid sourceCourseId' });
  }

  if (normalizedModuleIds.length === 0 && normalizedLessonIds.length === 0) {
    return res.status(400).json({ error: 'Nothing to import' });
  }

  try {
    // UNIT_ADMIN department checks resolve from Core — one batched catalog
    // fetch reused for the destination course, the module source course, and
    // every lesson source course below, instead of a live Core lookup per
    // course (#1072 unified contract; ADMIN/INSTRUCTOR never call Core here).
    let catalogById = null;
    if (authUser.role === 'UNIT_ADMIN') {
      const { courses: catalogCourses } = await resolveCoreCourseCatalog();
      catalogById = new Map(catalogCourses.map((c) => [c.id, c]));
    }
    // undefined = "resolve yourself" (non-UNIT_ADMIN, no Core call happens);
    // null = "resolved, not in catalog" (fail-closed department mismatch).
    const resolveFromCatalog = (row) =>
      catalogById ? (catalogById.get(row?.coreOfferingId) ?? null) : undefined;

    const destCourse = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!destCourse) return res.status(404).json({ error: 'Course not found' });
    if (!await isCourseAdmin(authUser, destCourse, resolveFromCatalog(destCourse))) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    if (normalizedModuleIds.length > 0) {
      if (numericSourceCourseId === null) {
        return res.status(400).json({ error: 'sourceCourseId required when importing modules' });
      }

      const sourceCourse = await prisma.courseOffering.findUnique({
        where: { id: numericSourceCourseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!sourceCourse || !await isCourseAdmin(authUser, sourceCourse, resolveFromCatalog(sourceCourse))) {
        return res.status(403).json({ error: 'Not authorized for source course' });
      }

      const moduleCount = await prisma.module.count({
        where: {
          id: { in: normalizedModuleIds },
          courseOfferingId: numericSourceCourseId,
        },
      });

      if (moduleCount !== normalizedModuleIds.length) {
        return res
          .status(400)
          .json({ error: 'One or more modules do not belong to source course' });
      }

      await cloneCourseContent(numericSourceCourseId, courseId, {
        moduleIds: normalizedModuleIds,
      });
    }

    if (normalizedLessonIds.length > 0) {
      if (numericTargetModuleId === null || !Number.isFinite(numericTargetModuleId)) {
        return res.status(400).json({ error: 'targetModuleId required when importing lessons' });
      }

      const targetModule = await prisma.module.findUnique({
        where: { id: numericTargetModuleId },
        select: { courseOfferingId: true },
      });

      if (!targetModule || targetModule.courseOfferingId !== courseId) {
        return res
          .status(400)
          .json({ error: 'targetModuleId does not belong to destination course' });
      }

      const lessons = await prisma.lesson.findMany({
        where: { id: { in: normalizedLessonIds } },
        include: {
          module: { select: { courseOfferingId: true } },
        },
      });

      if (lessons.length !== normalizedLessonIds.length) {
        return res.status(400).json({ error: 'One or more lessons were not found' });
      }

      const sourceCourseIds = new Set(lessons.map((lesson) => lesson.module.courseOfferingId));

      for (const scId of sourceCourseIds) {
        const sc = await prisma.courseOffering.findUnique({
          where: { id: scId },
          include: { instructors: { select: { userId: true } } },
        });
        if (!sc || !await isCourseAdmin(authUser, sc, resolveFromCatalog(sc))) {
          return res.status(403).json({ error: 'Not authorized for lesson source course' });
        }
      }

      await cloneLessonsFromOffering(normalizedLessonIds, numericTargetModuleId);
    }

    const updated = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              include: {
                activities: { orderBy: { position: 'asc' } },
              },
            },
          },
        },
      },
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /courses/:courseId/publish — flip course to published.
 *
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
 *
 * Why: intentionally non-cascading. Publishing a course doesn't auto-publish
 * its modules/lessons; the instructor must opt them in individually so a
 * half-finished module can't leak to students.
 */
router.patch('/courses/:courseId/publish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!await isCourseAdmin(authUser, course)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // #477: write through to Core first. If Core rejects, surface 500. There is
    // no local `isPublished` column to keep in sync anymore (#1072 step 4) —
    // Core is the sole store for publish state; this route now only proxies
    // the write and re-reads it back for the response.
    if (course.coreOfferingId) {
      await setCoreCoursePublishState(course.coreOfferingId, true);
    }

    const { course: coreCourse, coreUnavailable } = await resolveCoreCourseById(course.coreOfferingId);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }
    res.json(mapCourseOffering(course, coreCourse));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PATCH /courses/:courseId/unpublish — flip course unpublished, cascading down.
 *
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
 * Side effects: writes `isPublished=false` through to Core (the sole store
 *   for course publish state, #1072 step 4), then in a single local
 *   transaction sets `isPublished=false` on all of the course's modules and
 *   lessons.
 *
 * Why: the asymmetry with publish is deliberate — unpublishing must
 * immediately hide ALL child content from students; without the cascade a
 * module/lesson could remain reachable by direct URL.
 */
router.patch('/courses/:courseId/unpublish', requireRole(['INSTRUCTOR', 'UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const courseForAuth = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: { instructors: { select: { userId: true } } },
    });
    if (!courseForAuth) return res.status(404).json({ error: 'Course not found' });
    if (!await isCourseAdmin(authUser, courseForAuth)) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    // #477: write through to Core first; a Core failure aborts the local cascade.
    if (courseForAuth.coreOfferingId) {
      await setCoreCoursePublishState(courseForAuth.coreOfferingId, false);
    }

    // Cascade to all modules and lessons. No local courseOffering.isPublished
    // write anymore (#1072 step 4) — Core already got the write-through above.
    await prisma.$transaction(async (tx) => {
      // Update all modules in this course
      await tx.module.updateMany({
        where: { courseOfferingId: courseId },
        data: { isPublished: false },
      });

      // Update all lessons in modules of this course
      const modules = await tx.module.findMany({
        where: { courseOfferingId: courseId },
        select: { id: true },
      });
      const moduleIds = modules.map((m) => m.id);

      if (moduleIds.length > 0) {
        await tx.lesson.updateMany({
          where: { moduleId: { in: moduleIds } },
          data: { isPublished: false },
        });
      }
    });

    // No local courseOffering fields changed by the cascade above, so
    // `courseForAuth` (already fetched) is still an accurate anchor row.
    const { course: coreCourse, coreUnavailable } = await resolveCoreCourseById(
      courseForAuth.coreOfferingId,
    );
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }
    res.json(mapCourseOffering(courseForAuth, coreCourse));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Course-level analytics (§310) ─────────────────────────────────

/**
 * GET /courses/:courseId/feedback — all ActivityFeedback in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C). STUDENT → 403.
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get('/courses/:courseId/feedback', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const hasAdminAccess = await isCourseAdmin(authUser, course);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const { activityId, studentId } = req.query;
    if (req.query.take !== undefined && !Number.isFinite(Number(req.query.take))) {
      return res.status(400).json({ error: 'take must be a number' });
    }
    if (req.query.skip !== undefined && !Number.isFinite(Number(req.query.skip))) {
      return res.status(400).json({ error: 'skip must be a number' });
    }
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const where = {
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    };
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: 'activityId must be a number' });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const feedback = await prisma.activityFeedback.findMany({
      where,
      orderBy: [{ activityId: 'asc' }, { userId: 'asc' }, { createdAt: 'asc' }],
      take,
      skip,
    });

    res.json(feedback);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/submissions — all submissions in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get('/courses/:courseId/submissions', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const hasAdminAccess = await isCourseAdmin(authUser, course);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const { activityId, studentId } = req.query;
    if (req.query.take !== undefined && !Number.isFinite(Number(req.query.take))) {
      return res.status(400).json({ error: 'take must be a number' });
    }
    if (req.query.skip !== undefined && !Number.isFinite(Number(req.query.skip))) {
      return res.status(400).json({ error: 'skip must be a number' });
    }
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const where = {
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    };
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: 'activityId must be a number' });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const submissions = await prisma.submission.findMany({
      where,
      // `id` last: Submission has no unique constraint covering the leading
      // keys, so without it tied rows could shift between offset pages.
      orderBy: [
        { activityId: 'asc' },
        { userId: 'asc' },
        { attemptNumber: 'asc' },
        { id: 'asc' },
      ],
      take,
      skip,
      include: {
        activity: {
          select: {
            id: true,
            title: true,
            config: true,
            lesson: { select: { title: true } },
          },
        },
      },
    });

    // Resolve Core-owned student names (identity lives in Core, not this DB).
    // Best-effort: a missing service key or Core hiccup falls back to the raw
    // userId so the panel still renders.
    const nameById = new Map();
    if (course.coreOfferingId) {
      try {
        const enrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        for (const enrollment of enrollments) {
          if (enrollment?.studentId) nameById.set(enrollment.studentId, enrollment.studentName);
        }
      } catch {
        // Leave the map empty; rows degrade to the userId.
      }
    }

    const enriched = submissions.map((submission) => {
      const { activity, ...rest } = submission;
      const config = activity?.config ?? {};
      const choices = extractChoices(config);
      const response = rest.response ?? null;
      // MCQ picks store a zero-based option index; map it back to the option
      // label so instructors read the answer, not "Option 3".
      const optionIndex =
        response && typeof response.answerOption === 'number' ? response.answerOption : null;
      const answerLabel =
        optionIndex != null && choices && choices[optionIndex] != null
          ? choices[optionIndex]
          : null;
      return {
        ...rest,
        studentName: nameById.get(rest.userId) ?? null,
        activityTitle: activity?.title ?? null,
        lessonTitle: activity?.lesson?.title ?? null,
        questionText: config.question ?? config.prompt ?? null,
        answerLabel,
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/student-metrics — per-student aggregated metrics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get('/courses/:courseId/student-metrics', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const hasAdminAccess = await isCourseAdmin(authUser, course);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const rawMetrics = await prisma.activityStudentMetric.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
    });

    const byStudent = {};
    for (const m of rawMetrics) {
      if (!byStudent[m.userId]) {
        byStudent[m.userId] = {
          userId: m.userId,
          submissionCount: 0,
          correctSubmissionCount: 0,
          incorrectSubmissionCount: 0,
          helpRequestCount: 0,
        };
      }
      byStudent[m.userId].submissionCount += m.submissionCount;
      byStudent[m.userId].correctSubmissionCount += m.correctSubmissionCount;
      byStudent[m.userId].incorrectSubmissionCount += m.incorrectSubmissionCount;
      byStudent[m.userId].helpRequestCount += m.helpRequestCount;
    }

    res.json(Object.values(byStudent));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /courses/:courseId/analytics — per-activity aggregate analytics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get('/courses/:courseId/analytics', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const hasAdminAccess = await isCourseAdmin(authUser, course);
    const enrollment = course.enrollments.find((e) => e.userId === authUser.id);
    const isTa = enrollment?.role === 'TA';
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: 'Not authorized for this course' });
    }

    const analytics = await prisma.activityAnalytics.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
      include: { activity: { select: { id: true, title: true, lessonId: true } } },
      orderBy: { activityId: 'asc' },
    });

    res.json(analytics);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Dashboard rollups (§938) ─────────────────────────────────────

/**
 * GET /me/dashboard-stats — role-aware aggregate rollup across the caller's
 * visible courses.
 *
 * Auth: any authenticated user; response shape is scoped by role.
 * Returns numbers backed only by local tables (CourseOffering,
 * CourseEnrollment, Submission) plus, for ADMIN, counts sourced from the
 * existing Core admin-user / bug-report service calls already used elsewhere
 * in this file — never fabricated fields.
 *
 * Why: STUDENT/TA/INSTRUCTOR/UNIT_ADMIN/ADMIN all want a different rollup, so
 * this branches on role the same way `GET /courses` does rather than trying
 * to force one shape onto every caller.
 */
router.get('/me/dashboard-stats', async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });

  try {
    // Unified contract (#1072): published counts are FIELD reads — one
    // batched service-key catalog fetch, never the cookie-scoped list (whose
    // contents depend on the caller's own Core enrollment). No cookie-scoped
    // Core call happens in this route at all; nothing here consumes
    // `callerEnrollmentRole`.
    const { courses: catalogCourses, coreUnavailable } = await resolveCoreCourseCatalog();
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }
    const isCorePublished = (offering) => resolveIsPublished(offering, coreCoursesById);

    if (authUser.role === 'ADMIN') {
      const courses = await prisma.courseOffering.findMany({
        select: { coreOfferingId: true },
      });
      const publishedCourses = courses.filter(isCorePublished).length;

      const stats = {
        role: 'ADMIN',
        totalCourses: courses.length,
        publishedCourses,
        // #1043: the dashboard donut derived these from the full course array;
        // now that GET /courses is paged, they come from here (whole-set counts).
        draftCourses: courses.length - publishedCourses,
        syncedCourses: courses.filter((c) => c.coreOfferingId != null).length,
      };

      try {
        // #1041: read Core's `total` instead of counting a fetched list —
        // one row over the wire instead of the whole user table.
        const users = await listCoreAdminUsers(req.headers.cookie ?? '', { pageSize: 1 });
        if (typeof users?.total === 'number') stats.totalUsers = users.total;
      } catch (err) {
        console.warn('[me/dashboard-stats] Could not fetch Core users', err.message);
      }

      try {
        const reports = await listAdminBugReports(getEduAiCookieForRequest(req));
        if (Array.isArray(reports)) {
          stats.openBugReports = reports.filter((r) => r.status === 'unhandled').length;
        }
      } catch (err) {
        console.warn('[me/dashboard-stats] Could not fetch bug reports', err.message);
      }

      return res.json(stats);
    }

    if (authUser.role === 'INSTRUCTOR' || authUser.role === 'UNIT_ADMIN') {
      // `department` is Core-owned (#1072 step 4) — join the batch fetched
      // above rather than filtering by a local column. Same fail-soft
      // posture as `GET /courses`'s UNIT_ADMIN branch: an empty/unavailable
      // Core list degrades the department scope to empty, not an error.
      const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
      const deptCoreIds =
        authUser.role === 'UNIT_ADMIN' && units.length > 0
          ? catalogCourses.filter((c) => c?.department && units.includes(c.department)).map((c) => c.id)
          : [];
      const courseWhere =
        authUser.role === 'INSTRUCTOR'
          ? { instructors: { some: { userId: authUser.id } } }
          : {
              OR: [
                ...(deptCoreIds.length > 0 ? [{ coreOfferingId: { in: deptCoreIds } }] : []),
                { instructors: { some: { userId: authUser.id } } },
              ],
            };

      const courses = await prisma.courseOffering.findMany({
        where: courseWhere,
        select: { id: true, coreOfferingId: true },
      });
      const courseIds = courses.map((c) => c.id);
      const publishedCourses = courses.filter(isCorePublished).length;

      let enrolledStudents = 0;
      let submissionsToReview = 0;
      if (courseIds.length > 0) {
        const distinctStudents = await prisma.courseEnrollment.findMany({
          where: { courseOfferingId: { in: courseIds }, role: 'STUDENT' },
          select: { userId: true },
          distinct: ['userId'],
        });
        enrolledStudents = distinctStudents.length;

        submissionsToReview = await prisma.submission.count({
          where: {
            isCorrect: null,
            activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
          },
        });
      }

      return res.json({
        role: authUser.role,
        // Same value under two keys so the instructor view (yourCourses) and the
        // unit-admin view (totalCourses) each read the field they expect.
        yourCourses: courses.length,
        totalCourses: courses.length,
        publishedCourses,
        draftCourses: courses.length - publishedCourses,
        // #1043: the "synced" tile derived this from the full course array.
        syncedCourses: courses.filter((c) => c.coreOfferingId != null).length,
        enrolledStudents,
        submissionsToReview,
      });
    }

    // TA — either the platform role is TA, or a STUDENT account also holds a
    // TA enrollment on at least one course (mirrors GET /courses §174).
    const isEffectiveTa =
      authUser.role === 'TA' || (authUser.role === 'STUDENT' && (await userHasTaEnrollment(authUser.id)));

    if (isEffectiveTa) {
      const taEnrollments = await prisma.courseEnrollment.findMany({
        where: { userId: authUser.id, role: 'TA' },
        select: { courseOfferingId: true },
      });
      const courseIds = taEnrollments.map((e) => e.courseOfferingId);

      const [submissionsToReview, taCourses] =
        courseIds.length > 0
          ? await Promise.all([
              prisma.submission.count({
                where: {
                  isCorrect: null,
                  activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
                },
              }),
              prisma.courseOffering.findMany({
                where: { id: { in: courseIds } },
                select: { coreOfferingId: true },
              }),
            ])
          : [0, []];
      const publishedCourses = taCourses.filter(isCorePublished).length;

      return res.json({
        role: 'TA',
        yourCourses: courseIds.length,
        publishedCourses,
        submissionsToReview,
      });
    }

    // STUDENT (default)
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: authUser.id, role: 'STUDENT' },
      select: { courseOfferingId: true },
    });
    const enrolledCourseIds = enrollments.map((e) => e.courseOfferingId);
    const rawCourses =
      enrolledCourseIds.length > 0
        ? await prisma.courseOffering.findMany({
            where: { id: { in: enrolledCourseIds } },
            select: { id: true, coreOfferingId: true },
          })
        : [];
    const courses = rawCourses.filter(isCorePublished);

    const progresses = await Promise.all(
      courses.map((c) => calculateCourseProgress(c.id, authUser.id)),
    );
    const completedCourses = progresses.filter((p) => p.total > 0 && p.completed === p.total).length;
    const inProgressCourses = progresses.filter(
      (p) => p.total > 0 && p.completed > 0 && p.completed < p.total,
    ).length;

    const [correctCount, gradedCount] = await Promise.all([
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: true } }),
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: { not: null } } }),
    ]);
    const correctAnswerPercentage =
      gradedCount > 0 ? Math.round((correctCount / gradedCount) * 100) : 0;

    res.json({
      role: 'STUDENT',
      enrolledCourses: courses.length,
      coursesInProgress: inProgressCourses,
      coursesCompleted: completedCourses,
      correctAnswerPercentage,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
