/**
 * Router for course and topic CRUD. Read/update/delete are gated per-course via
 * requireCourseAccess (rbac-matrix §3/§5), which resolves the caller's access from
 * Core enrollment/unit data — so ADMIN, UNIT_ADMIN (in-unit) and enrolled instructor
 * peers reach a course, not just its original owner.
 */
import express from 'express';
import { Course, Question_Metadata, Topics } from '../schema/index.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  requireCourseAccess,
  resolveCourseAccessWithCourse,
} from '../middleware/courseAccess.js';
import {
  pushTopicToCore,
  isCoreCourseInScopedList,
} from '../services/coreApiService.js';
import { listCoursesForUser } from '../services/courseListService.js';
import { ensureCoreCourseLink } from '../services/coreCourseLinkService.js';
import { syncTopicsFromCoreForCourse } from '../services/topicSyncService.js';
import { importTaughtCoursesFromCore } from '../services/importTaughtCoursesService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/** Resolves the QM course id from the URL param for per-course access gates. */
const courseIdFromParam = (req) => req.params.id;

/**
 * POST /api/course – creates a local QM course owned by the authenticated user.
 *
 * NOTE: course creation gating is intentionally left unchanged here — Core is the
 * intended source of truth for courses and this endpoint is being addressed
 * separately. Per-course RBAC on read/update/delete is enforced below.
 */
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { name, courseCode } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Course name is required'
      });
    }

    const courseData = await Course.create({
      userId: req.user.id,
      name: name.trim(),
      code: courseCode || null
    });

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: courseData
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/course – lists the courses the caller may access, role-scoped per the
 * RBAC matrix (§5): ADMIN sees all, UNIT_ADMIN sees their units, INSTRUCTOR sees
 * courses they are enrolled in. Optionally includes per-course question/topic stats.
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    try {
      await importTaughtCoursesFromCore(
        req.user.id,
        req.user.role ?? 'STUDENT',
        req.headers.cookie ?? '',
      );
    } catch (err) {
      logger.warn({ err, userId: req.user.id }, 'Core course mirror failed on list');
    }

    const { includeStats = false } = req.query;

    const courses = await listCoursesForUser(req.user, { cookie: req.headers.cookie });

    if (includeStats !== 'true') {
      return res.json({ success: true, data: courses });
    }

    // Stats are scoped to the courses the caller can already see.
    const visibleIds = courses.map((course) => course.id);
    const statRows = visibleIds.length
      ? await Course.findAll({
          where: { id: visibleIds },
          include: [
            {
              model: Question_Metadata,
              as: 'questionMetadata',
              attributes: ['id', 'type', 'description'],
              required: false
            },
            {
              model: Topics,
              as: 'topics',
              attributes: ['id', 'name'],
              required: false
            }
          ]
        })
      : [];

    const statsById = new Map(
      statRows.map((course) => [
        course.id,
        {
          totalQuestions: course.questionMetadata?.length || 0,
          totalTopics: course.topics?.length || 0,
          questionTypes: course.questionMetadata?.reduce((acc, q) => {
            acc[q.type] = (acc[q.type] || 0) + 1;
            return acc;
          }, {}) || {}
        }
      ])
    );

    const coursesWithStats = courses.map((course) => ({
      ...course,
      stats: statsById.get(course.id) ?? {
        totalQuestions: 0,
        totalTopics: 0,
        questionTypes: {}
      }
    }));

    res.json({ success: true, data: coursesWithStats });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/course/:id/access – resolves the caller's access level for UI gating
 * (shared contract §3). Returns `{ level, rank }` or null `data` when the caller
 * has no access; 404 only when the course does not exist.
 */
router.get('/:id/access', authenticateToken, async (req, res, next) => {
  try {
    const { course, access } = await resolveCourseAccessWithCourse(req.user, req.params.id, {
      cookie: req.headers.cookie,
    });

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    res.json({ success: true, data: access });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/course/:id – fetches a single course, optionally with details. Visible
 * to any caller with at least TA access to the course (§5 view course details).
 */
router.get(
  '/:id',
  authenticateToken,
  requireCourseAccess({ min: 'ta', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
    try {
      const { includeDetails = false } = req.query;

      if (includeDetails !== 'true') {
        return res.json({ success: true, data: req.qmCourse });
      }

      const courseData = await Course.findOne({
        where: { id: req.qmCourse.id },
        include: [
          {
            model: Question_Metadata,
            as: 'questionMetadata',
            attributes: ['id', 'type', 'description', 'questionOrder'],
            include: [
              {
                model: Topics,
                as: 'primaryTopic',
                attributes: ['id', 'name']
              }
            ]
          },
          {
            model: Topics,
            as: 'topics',
            attributes: ['id', 'name']
          }
        ]
      });

      res.json({ success: true, data: courseData });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /api/course/:id – updates course metadata (§5 edit: instructor access or above). */
router.put(
  '/:id',
  authenticateToken,
  requireCourseAccess({ min: 'instructor', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
    try {
      const { name, courseCode } = req.body;
      const courseData = req.qmCourse;

      await courseData.update({
        ...(name !== undefined && { name: name?.trim() || courseData.name }),
        ...(courseCode !== undefined && { code: courseCode || null })
      });

      res.json({
        success: true,
        message: 'Course updated successfully',
        data: courseData
      });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /api/course/:id – removes a course and its associations (§5 delete: instructor+). */
router.delete(
  '/:id',
  authenticateToken,
  requireCourseAccess({ min: 'instructor', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
    try {
      await req.qmCourse.destroy();

      res.json({
        success: true,
        message: 'Course deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/course/:id/topics – returns the topic list (§8 view topics: TA access or above). */
router.get(
  '/:id/topics',
  authenticateToken,
  requireCourseAccess({ min: 'ta', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
  try {
    const course = req.qmCourse;

    const cookie = req.headers.cookie ?? '';
    if (await ensureCoreCourseLink(course, cookie)) {
      await course.reload();
    }

    if (course.coreCourseId) {
      await syncTopicsFromCoreForCourse(course, cookie);
    }

    const topics = await Topics.findAll({
      where: { courseId: req.params.id },
      order: [['createdAt', 'ASC']]
    });

    res.json({
      success: true,
      data: topics
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/course/:id/topics – adds a topic (§8 create topic: instructor access or above). */
router.post(
  '/:id/topics',
  authenticateToken,
  requireCourseAccess({ min: 'instructor', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Topic name is required'
      });
    }

    const course = req.qmCourse;

    const topic = await Topics.create({
      courseId: req.params.id,
      name: name.trim()
    });

    if (course.coreCourseId) {
      try {
        const coreResult = await pushTopicToCore(course.coreCourseId, name.trim());
        if (coreResult?.id) {
          await topic.update({ coreTopicId: coreResult.id });
        }
      } catch (coreErr) {
        logger.warn({ err: coreErr }, 'Core topic push failed; local topic created without Core link');
      }
    }

    res.status(201).json({
      success: true,
      message: 'Topic created successfully',
      data: topic
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/course/:id/link-core – stores a Core course CUID (§18 link: instructor access or above). */
router.patch(
  '/:id/link-core',
  authenticateToken,
  requireCourseAccess({ min: 'instructor', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
  try {
    const { coreCourseId } = req.body;

    if (!coreCourseId || typeof coreCourseId !== 'string') {
      return res.status(400).json({ success: false, error: 'coreCourseId is required' });
    }

    const course = req.qmCourse;

    const cookie = req.headers.cookie ?? '';
    let linkable = false;
    try {
      linkable = await isCoreCourseInScopedList(coreCourseId, cookie);
    } catch (err) {
      const status = Number.isInteger(err?.status) ? err.status : 502;
      return res.status(status).json({
        success: false,
        error: err.message || 'Failed to verify Core course access',
      });
    }

    if (!linkable) {
      return res.status(403).json({ success: false, error: 'CORE_COURSE_NOT_AUTHORIZED' });
    }

    await course.update({ coreCourseId });

    res.json({ success: true, data: course });
  } catch (error) {
    next(error);
  }
});

/** POST /api/course/:id/sync-topics – pulls topics from Core (§18 sync: instructor access or above). */
router.post(
  '/:id/sync-topics',
  authenticateToken,
  requireCourseAccess({ min: 'instructor', getCourseId: courseIdFromParam }),
  async (req, res, next) => {
  try {
    const course = req.qmCourse;

    const cookie = req.headers.cookie ?? '';
    if (await ensureCoreCourseLink(course, cookie)) {
      await course.reload();
    }

    if (!course.coreCourseId) {
      return res.status(400).json({ success: false, error: 'Course is not linked to Core' });
    }

    let synced;
    try {
      synced = await syncTopicsFromCoreForCourse(course, cookie, { failOnCoreError: true });
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: err.message || 'Core request failed',
      });
    }

    res.json({ success: true, data: { synced } });
  } catch (error) {
    next(error);
  }
});

export default router;
