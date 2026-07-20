/**
 * @file Admin-only endpoints: user/course inventory, manual enrollment ops,
 *       EduAI API key management, AI model policy, and EduAI enrollment resync.
 *
 * Responsibility: Backstage controls for the admin console — everything that
 *   isn't owned by an instructor or student in their normal flow.
 * Callers: Mounted under `/api`; consumed by the React `app/admin.tsx` page.
 *   The session middleware already restricts ADMIN users to `/api/me` and
 *   `/api/admin/*`, so these handlers don't double-check role beyond `requireRole`.
 * Gotchas:
 *   - User roles are owned by EduAI, NOT this DB. The role-update endpoint is
 *     intentionally a 410 GONE so a future maintainer doesn't try to "fix" it
 *     by writing to local user rows — that would silently diverge from EduAI.
 *   - Manual enrollment endpoints work for any course, but the dedicated
 *     `sync-enrollments` only accepts EduAI-imported courses.
 *   - System settings (`EDUAI_API_KEY`, `AI_MODEL_POLICY`) live in the
 *     `SystemSetting` key/value table, not env vars — admin updates take
 *     effect immediately for subsequent requests.
 * Related: services/systemSettings.js, services/aiModelPolicy.js,
 *   services/enrollmentSync.js, services/eduaiAuth.js, middleware/auth.js
 */

import express from 'express';
import { prisma } from '../config/database.js';
import { requireRole, isCourseAdmin } from '../middleware/auth.js';
import {
  SYSTEM_SETTING_KEYS,
  clearSystemSetting,
  getEduAiApiKeyStatus,
  setSystemSetting,
} from '../services/systemSettings.js';
import { getAiModelPolicyState, setAiModelPolicy } from '../services/aiModelPolicy.js';
import { mapCoreAdminUser, mapCourseOffering } from '../utils/mappers.js';
import { getEduAiCookieForRequest } from '../services/eduaiAuth.js';
import { indexCoreCoursesById, resolveCoreCourseCatalog } from '../services/courseResolver.js';
import { syncCourseEnrollments } from '../services/enrollmentSync.js';
import { ensureOfferingAnchors } from '../services/importTaughtCoursesService.js';
import {
  deleteCoreEnrollment,
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  patchCoreEnrollmentRole,
} from '../services/eduaiClient.js';

const router = express.Router();


router.get('/admin/users', requireRole('ADMIN'), async (req, res) => {
  try {
    // #1041: Core requires paging here, so this route pages too rather than
    // proxying a full table. Paging params pass straight through.
    const cookie = req.headers.cookie ?? '';
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 25;
    const envelope = await listCoreAdminUsers(cookie, {
      page,
      pageSize,
      ...(req.query.search ? { search: String(req.query.search) } : {}),
      ...(req.query.role ? { role: String(req.query.role) } : {}),
    });
    const rows = Array.isArray(envelope?.data) ? envelope.data : [];
    res.json({
      data: rows.map(mapCoreAdminUser),
      total: envelope?.total ?? rows.length,
      page: envelope?.page ?? page,
      pageSize: envelope?.pageSize ?? pageSize,
      // Platform-wide counts from Core (#1041) — the dashboard's role breakdown
      // used to be derived by counting a full user list.
      stats: envelope?.stats ?? { total: 0, active: 0, byRole: {} },
    });
  } catch (e) {
    const status = typeof e?.status === 'number' ? e.status : 500;
    res.status(status).json({ error: String(e.message ?? e) });
  }
});

/**
 * PATCH /admin/users/:userId/role — DEPRECATED, returns 410 GONE.
 *
 * Why: roles are sourced from EduAI; writing them locally would silently
 * diverge on the next sync. Endpoint is kept (rather than deleted) so the
 * frontend gets an explicit signal instead of a 404. Do not "fix" by editing
 * the local DB — change the user's role in EduAI instead.
 */
router.patch('/admin/users/:userId/role', requireRole('ADMIN'), async (req, res) => {
  return res.status(410).json({ error: 'Roles are managed in EduAI' });
});

router.get('/admin/courses', requireRole('ADMIN'), async (req, res) => {
  try {
    // Unified contract (#1072): fields come from ONE service-key catalog
    // fetch, joined against the local anchors — same read-through shape as
    // `GET /courses`'s ADMIN branch. No cookie-scoped call: nothing here
    // consumes `callerEnrollmentRole`.
    const { courses: catalogCourses, coreUnavailable } = await resolveCoreCourseCatalog();
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }
    // Create-on-open (#1072 step 3 / #1074): materialize an anchor for every
    // Core course before listing, so this shows Core's full catalog rather
    // than whatever happened to already have a local row.
    if (!coreUnavailable && catalogCourses.length > 0) {
      await ensureOfferingAnchors(catalogCourses.map((c) => c.id));
    }
    const courses = await prisma.courseOffering.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    res.json(courses.map((c) => mapCourseOffering(c, coreCoursesById.get(c.coreOfferingId))));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /admin/courses/:courseId/enrollments — list enrolled + addable students.
 *
 * Auth: ADMIN.
 * Returns: `{ courseId, enrolledStudents, availableStudents }`.
 *
 * Why: bundles both lists in one response so the admin enrollment editor can
 * render add/remove pickers without a second roundtrip; `availableStudents`
 * excludes anyone already enrolled.
 */
router.get(
  '/admin/courses/:courseId/enrollments',
  requireRole(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: {
          enrollments: true,
          instructors: { select: { userId: true } },
        },
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (!await isCourseAdmin(authUser, course)) {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      // Fetch real names/emails from Core users (primary) and course enrollments (secondary).
      let coreEnrollmentMap = new Map();
      if (course.coreOfferingId) {
        try {
          const coreEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
          for (const e of coreEnrollments) {
            coreEnrollmentMap.set(e.studentId, { name: e.studentName, email: e.studentEmail });
          }
        } catch (err) {
          console.warn('[admin] Could not fetch Core enrollment names for course', courseId, err.message);
        }
      }

      const enrolledUserIds = new Set(course.enrollments.map((e) => e.userId));
      let coreUserMap = new Map();
      let availableStudents = [];

      try {
        const cookie = req.headers.cookie ?? '';
        // #1041/#1125: two targeted reads instead of one full-table fetch —
        // an `?ids=` lookup for the enrolled users' display names, and a
        // role-scoped page for the "add a student" picker.
        const enrolledIds = [...enrolledUserIds];
        const [enrolledEnvelope, studentEnvelope] = await Promise.all([
          listCoreAdminUsers(cookie, { ids: enrolledIds }),
          listCoreAdminUsers(cookie, { role: 'STUDENT', page: 1, pageSize: 200 }),
        ]);
        for (const user of (enrolledEnvelope?.data ?? []).map(mapCoreAdminUser)) {
          coreUserMap.set(user.id, { name: user.name, email: user.email });
        }
        availableStudents = (studentEnvelope?.data ?? [])
          .map(mapCoreAdminUser)
          .filter((user) => !enrolledUserIds.has(user.id))
          .toSorted((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        console.warn('[admin] Could not fetch Core users for enrollment display', courseId, err.message);
      }

      res.json({
        courseId,
        enrolledStudents: course.enrollments
          .toSorted((a, b) => a.userId.localeCompare(b.userId))
          .map((e) => {
            const userInfo = coreUserMap.get(e.userId) ?? coreEnrollmentMap.get(e.userId);
            const displayName = userInfo?.name?.trim() || e.userId;
            return {
              id: e.userId,
              name: displayName,
              email: userInfo?.email ?? '',
              role: e.role,
              createdAt: e.createdAt,
            };
          }),
        availableStudents,
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

/**
 * POST /admin/courses/:courseId/enrollments — enroll a student in a course.
 *
 * Auth: ADMIN. Target user must have role STUDENT.
 * Side effects: idempotent upsert into CourseEnrollment.
 *
 * Why: idempotent so accidental double-clicks in the admin UI don't error.
 */
router.post(
  '/admin/courses/:courseId/enrollments',
  requireRole(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    const userId =
      typeof req.body?.userId === 'string' && req.body.userId.trim().length > 0
        ? req.body.userId.trim()
        : null;
    const rawRole = req.body?.role;
    const enrollmentRole =
      rawRole === 'TA' || rawRole === 'STUDENT' ? rawRole : 'STUDENT';

    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (!await isCourseAdmin(authUser, course)) {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      await prisma.courseEnrollment.upsert({
        where: {
          courseOfferingId_userId: {
            courseOfferingId: courseId,
            userId,
          },
        },
        update: { role: enrollmentRole },
        create: {
          courseOfferingId: courseId,
          userId,
          role: enrollmentRole,
        },
      });

      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  },
);

router.delete(
  '/admin/courses/:courseId/enrollments/:userId',
  requireRole(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';

    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (!await isCourseAdmin(authUser, course)) {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      // Write through to Core first, so a later sync doesn't re-import the student (#812).
      if (course.coreOfferingId) {
        const coreEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        const coreEnrollment = coreEnrollments.find((e) => e.studentId === userId);
        if (!coreEnrollment) {
          return res.status(404).json({ error: 'Enrollment not found in Core' });
        }
        const cookie = getEduAiCookieForRequest(req);
        await deleteCoreEnrollment(course.coreOfferingId, coreEnrollment.id, cookie);
      }

      await prisma.courseEnrollment.deleteMany({
        where: {
          courseOfferingId: courseId,
          userId,
        },
      });

      res.json({ ok: true });
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 500;
      res.status(status).json({ error: String(e) });
    }
  },
);

/**
 * PATCH /admin/courses/:courseId/enrollments/:userId/role — assign or remove TA role.
 *
 * Auth: ADMIN, UNIT_ADMIN (department-scoped), or INSTRUCTOR (course-scoped).
 * Body: `{ role: 'STUDENT' | 'TA' }`.
 * Side effects: updates the enrollment role in place.
 *
 * Why: dedicated endpoint so TA assignment doesn't require a delete+re-enroll
 * cycle that would lose audit history on the enrollment row.
 */
router.patch(
  '/admin/courses/:courseId/enrollments/:userId/role',
  requireRole(['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR']),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    const rawRole = req.body?.role;

    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (rawRole !== 'STUDENT' && rawRole !== 'TA') {
      return res.status(400).json({ error: 'role must be STUDENT or TA' });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });

      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (!await isCourseAdmin(authUser, course)) {
        return res.status(403).json({ error: 'Not authorized for this course' });
      }

      const enrollment = await prisma.courseEnrollment.findUnique({
        where: { courseOfferingId_userId: { courseOfferingId: courseId, userId } },
      });

      if (!enrollment) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      let coreRollback = null;
      if (course.coreOfferingId) {
        const coreEnrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        const coreEnrollment = coreEnrollments.find((e) => e.studentId === userId);
        if (!coreEnrollment) {
          return res.status(404).json({ error: 'Enrollment not found in Core' });
        }
        const cookie = getEduAiCookieForRequest(req);
        await patchCoreEnrollmentRole(course.coreOfferingId, coreEnrollment.id, rawRole, cookie);
        coreRollback = () =>
          patchCoreEnrollmentRole(course.coreOfferingId, coreEnrollment.id, enrollment.role, cookie).catch(() => {});
      }

      try {
        const updated = await prisma.courseEnrollment.update({
          where: { courseOfferingId_userId: { courseOfferingId: courseId, userId } },
          data: { role: rawRole },
        });
        res.json({ ok: true, role: updated.role });
      } catch (dbErr) {
        coreRollback?.();
        throw dbErr;
      }
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 500;
      res.status(status).json({ error: String(e) });
    }
  },
);

router.get('/admin/settings/eduai-api-key', requireRole('ADMIN'), async (req, res) => {
  try {
    const status = await getEduAiApiKeyStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PUT /admin/settings/eduai-api-key — store/replace the EduAI API key.
 *
 * Auth: ADMIN.
 * Side effects: writes the key into SystemSetting('EDUAI_API_KEY'); subsequent
 *   session-cookie EduAI calls will use the new key.
 *
 * Why: stored in DB rather than env so admins can rotate without redeploying.
 */
router.put('/admin/settings/eduai-api-key', requireRole('ADMIN'), async (req, res) => {
  const apiKey = req.body?.apiKey;
  if (typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey must be a string' });
  }

  const trimmed = apiKey.trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'apiKey cannot be empty' });
  }

  try {
    await setSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY, trimmed);
    const status = await getEduAiApiKeyStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete('/admin/settings/eduai-api-key', requireRole('ADMIN'), async (req, res) => {
  try {
    await clearSystemSetting(SYSTEM_SETTING_KEYS.EDUAI_API_KEY);
    const status = await getEduAiApiKeyStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get('/admin/settings/ai-model-policy', requireRole('ADMIN'), async (_req, res) => {
  try {
    const state = await getAiModelPolicyState();
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * PUT /admin/settings/ai-model-policy — replace the active AI model policy.
 *
 * Auth: ADMIN.
 * Side effects: persists policy in SystemSetting('AI_MODEL_POLICY'); affects
 *   which models students can pick and the supervisor/dual-loop behavior on
 *   subsequent AI chat requests.
 *
 * Why: validation errors thrown from the service include the words "must" or
 * "At least one" — those are mapped to 400 here so the admin form can surface
 * field-level errors instead of generic 500s.
 */
router.put('/admin/settings/ai-model-policy', requireRole('ADMIN'), async (req, res) => {
  try {
    const state = await setAiModelPolicy(req.body || {});
    res.json(state);
  } catch (e) {
    const status = Number.isInteger(e?.status)
      ? e.status
      : e?.message?.includes('must') || e?.message?.includes('At least one')
        ? 400
        : 500;
    res.status(status).json({ error: String(e.message || e) });
  }
});

/**
 * GET /admin/ai-traces — recent AiInteractionTrace rows for oversight.
 *
 * Auth: UNIT_ADMIN (scoped to `authorizedUnits` via the Core course's live
 *   `department`), ADMIN (unscoped).
 * Query params: `unit` (department filter — for UNIT_ADMIN it must be one of
 *   their authorized units), `courseId` (numeric CourseOffering id), `limit`
 *   (default 50, max 200).
 *
 * Why: `AiInteractionTrace.userId` has no local FK (User is owned by Core), so
 * display names are resolved the same way `/admin/courses/:courseId/enrollments`
 * already does — via `listCoreAdminUsers` and an id->name map — rather than a
 * Prisma include that can't exist. `department` and `courseTitle` are
 * Core-owned too (#1072 step 4, no local column): both are resolved by
 * joining one batched `GET /api/courses` fetch against the local anchor rows
 * by `coreOfferingId`, same pattern as `routes/courses.js`. Fail-soft: a
 * Core outage degrades UNIT_ADMIN's department scope to empty (never a hard
 * error or an unscoped leak).
 */
router.get('/admin/ai-traces', requireRole(['UNIT_ADMIN', 'ADMIN']), async (req, res) => {
  const authUser = req.user;
  const { unit } = req.query;

  let numericCourseId = null;
  if (req.query.courseId !== undefined) {
    numericCourseId = Number(req.query.courseId);
    if (!Number.isFinite(numericCourseId)) {
      return res.status(400).json({ error: 'courseId must be a number' });
    }
  }

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  try {
    // Unified contract (#1072): department/courseTitle are fields — one
    // service-key catalog fetch, no cookie-scoped call.
    const { courses: catalogCourses, coreUnavailable } = await resolveCoreCourseCatalog();
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set('X-Core-Status', 'unavailable');
    }

    const courseOfferingWhere = {};

    if (authUser.role === 'UNIT_ADMIN') {
      const units = Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : [];
      if (units.length === 0) {
        return res.json([]);
      }
      if (unit) {
        if (!units.includes(unit)) {
          return res.status(403).json({ error: 'Not authorized for this unit' });
        }
        const deptCoreIds = catalogCourses.filter((c) => c?.department === unit).map((c) => c.id);
        courseOfferingWhere.coreOfferingId = { in: deptCoreIds };
      } else {
        const deptCoreIds = catalogCourses
          .filter((c) => c?.department && units.includes(c.department))
          .map((c) => c.id);
        courseOfferingWhere.coreOfferingId = { in: deptCoreIds };
      }
    } else if (unit) {
      // ADMIN scoping by unit is optional filtering, not an authorization boundary.
      const deptCoreIds = catalogCourses.filter((c) => c?.department === unit).map((c) => c.id);
      courseOfferingWhere.coreOfferingId = { in: deptCoreIds };
    }

    if (numericCourseId !== null) {
      courseOfferingWhere.id = numericCourseId;
    }

    const traces = await prisma.aiInteractionTrace.findMany({
      where: {
        activity: {
          lesson: { module: { courseOffering: courseOfferingWhere } },
        },
      },
      include: {
        activity: {
          select: {
            id: true,
            title: true,
            lesson: {
              select: {
                module: {
                  select: {
                    courseOfferingId: true,
                    courseOffering: { select: { coreOfferingId: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    let userNameMap = new Map();
    try {
      const cookie = req.headers.cookie ?? '';
      // #1125: resolve only the users these traces reference. Fetching the whole
      // table to build this map would mean page-looping it under #1041.
      const traceUserIds = [...new Set(traces.map((t) => t.userId).filter(Boolean))];
      const envelope = await listCoreAdminUsers(cookie, { ids: traceUserIds });
      for (const u of envelope?.data ?? []) {
        userNameMap.set(u.id, u.name ?? '');
      }
    } catch (err) {
      console.warn('[admin] Could not fetch Core users for ai-traces', err.message);
    }

    const result = traces.map((t) => ({
      id: t.id,
      mode: t.mode,
      knowledgeLevel: t.knowledgeLevel,
      tutorModelId: t.tutorModelId,
      supervisorModelId: t.supervisorModelId,
      iterationCount: t.iterationCount,
      finalOutcome: t.finalOutcome,
      createdAt: t.createdAt,
      user: { id: t.userId, name: userNameMap.get(t.userId) ?? null },
      activity: { id: t.activity.id, title: t.activity.title },
      courseId: t.activity.lesson.module.courseOfferingId,
      courseTitle:
        coreCoursesById.get(t.activity.lesson.module.courseOffering?.coreOfferingId)?.name ?? null,
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post('/admin/courses/:courseId/sync-enrollments', requireRole('ADMIN'), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({ where: { id: courseId } });
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!course.coreOfferingId) {
      return res.status(400).json({ error: 'Course is not imported from EduAI' });
    }

    const result = await syncCourseEnrollments(courseId, { course });
    res.json(result);
  } catch (error) {
    console.error('[eduai] Manual enrollment sync failed:', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ error: error.message || 'Enrollment sync failed' });
  }
});

export default router;
