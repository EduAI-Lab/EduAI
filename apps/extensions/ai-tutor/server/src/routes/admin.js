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
import { requireRole } from '../middleware/auth.js';
import {
  SYSTEM_SETTING_KEYS,
  clearSystemSetting,
  getEduAiApiKeyStatus,
  setSystemSetting,
} from '../services/systemSettings.js';
import { getAiModelPolicyState, setAiModelPolicy } from '../services/aiModelPolicy.js';
import { mapAdminUser, mapCourseOffering } from '../utils/mappers.js';
import { getEduAiAccessTokenForUser } from '../services/eduaiAuth.js';
import { syncCourseEnrollments } from '../services/enrollmentSync.js';

const router = express.Router();

router.get('/admin/users', requireRole('ADMIN'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    res.json(users.map(mapAdminUser));
  } catch (e) {
    res.status(500).json({ error: String(e) });
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

router.get('/admin/courses', requireRole('ADMIN'), async (_req, res) => {
  try {
    const courses = await prisma.courseOffering.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    res.json(courses.map(mapCourseOffering));
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
router.get('/admin/courses/:courseId/enrollments', requireRole('ADMIN'), async (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        enrollments: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const enrolledIds = course.enrollments.map((enrollment) => enrollment.userId);
    const availableStudents = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        id: { notIn: enrolledIds.length > 0 ? enrolledIds : undefined },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    res.json({
      courseId,
      enrolledStudents: course.enrollments
        .map((enrollment) => enrollment.user)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(mapAdminUser),
      availableStudents: availableStudents.map(mapAdminUser),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /admin/courses/:courseId/enrollments — enroll a student in a course.
 *
 * Auth: ADMIN. Target user must have role STUDENT.
 * Side effects: idempotent upsert into CourseEnrollment.
 *
 * Why: idempotent so accidental double-clicks in the admin UI don't error.
 */
router.post('/admin/courses/:courseId/enrollments', requireRole('ADMIN'), async (req, res) => {
  const courseId = Number(req.params.courseId);
  const userId =
    typeof req.body?.userId === 'string' && req.body.userId.trim().length > 0
      ? req.body.userId.trim()
      : null;

  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    const [course, user] = await Promise.all([
      prisma.courseOffering.findUnique({ where: { id: courseId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!user || user.role !== 'STUDENT') {
      return res.status(400).json({ error: 'Only student users can be enrolled' });
    }

    await prisma.courseEnrollment.upsert({
      where: {
        courseOfferingId_userId: {
          courseOfferingId: courseId,
          userId,
        },
      },
      update: {},
      create: {
        courseOfferingId: courseId,
        userId,
      },
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete(
  '/admin/courses/:courseId/enrollments/:userId',
  requireRole('ADMIN'),
  async (req, res) => {
    const courseId = Number(req.params.courseId);
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';

    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: 'Invalid course id' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    try {
      await prisma.courseEnrollment.deleteMany({
        where: {
          courseOfferingId: courseId,
          userId,
        },
      });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
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
 *   `getEduAiAccessTokenForUser` calls will use the new key.
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

    if (!course.externalId || course.externalSource !== 'EDUAI') {
      return res.status(400).json({ error: 'Course is not imported from EduAI' });
    }

    const accessToken = await getEduAiAccessTokenForUser(req.user?.id);

    // Pass the already-fetched course to avoid a duplicate DB lookup inside the service
    const result = await syncCourseEnrollments(courseId, { accessToken, course });
    res.json(result);
  } catch (error) {
    console.error('[eduai] Manual enrollment sync failed:', error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ error: error.message || 'Enrollment sync failed' });
  }
});

export default router;
