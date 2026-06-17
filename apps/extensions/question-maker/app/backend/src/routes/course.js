/**
 * Router responsible for course and topic CRUD scoped to authenticated instructors.
 * Performs ownership checks before touching Sequelize models to keep tenant data isolated.
 */
import express from 'express';
import { Course, Question_Metadata, Topics } from '../schema/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { QM_AUTHORIZED } from '../middleware/roles.js';
import { resolveCourseAccessWithCourse, LEVELS } from '../middleware/courseAccess.js';
import { listCoursesForUser } from '../services/courseListService.js';
import { getCourseTopicsFromCore, pushTopicToCore, isCoreCourseInScopedList } from '../services/coreApiService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(authenticateToken, requireRole(QM_AUTHORIZED));

async function loadCourseWithAccess(req, res, minRank = LEVELS.instructor.rank) {
  const { course, access } = await resolveCourseAccessWithCourse(req.user, req.params.id, {
    cookie: req.headers.cookie,
  });
  if (!course) {
    res.status(404).json({ success: false, error: 'Course not found' });
    return null;
  }
  if (!access || access.rank < minRank) {
    res.status(403).json({ success: false, error: 'Insufficient course access' });
    return null;
  }
  return { course, access };
}

/** POST /api/course – creates a course tied to the authenticated user after basic validation. */
router.post('/', async (req, res, next) => {
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

/** GET /api/course – role-scoped list with optional stats. */
router.get('/', async (req, res, next) => {
  try {
    const { includeStats = false } = req.query;

    const courses = await listCoursesForUser(req.user, { cookie: req.headers.cookie });

    if (includeStats !== 'true') {
      return res.json({ success: true, data: courses });
    }

    const courseIds = courses.map((c) => c.id);
    const withRelations = await Course.findAll({
      where: { id: courseIds },
      include: [
        {
          model: Question_Metadata,
          as: 'questionMetadata',
          attributes: ['id', 'type', 'description'],
          required: false,
        },
        {
          model: Topics,
          as: 'topics',
          attributes: ['id', 'name'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const relationById = new Map(withRelations.map((c) => [c.id, c]));
    const coursesWithStats = courses.map((course) => {
      const rel = relationById.get(course.id);
      const meta = rel?.questionMetadata ?? [];
      const topics = rel?.topics ?? [];
      return {
        ...course,
        stats: {
          totalQuestions: meta.length,
          totalTopics: topics.length,
          questionTypes: meta.reduce((acc, q) => {
            acc[q.type] = (acc[q.type] || 0) + 1;
            return acc;
          }, {}),
        },
      };
    });

    res.json({ success: true, data: coursesWithStats });
  } catch (error) {
    next(error);
  }
});

/** GET /api/course/:id/access – caller's resolved access for UI gating. */
router.get('/:id/access', async (req, res, next) => {
  try {
    const loaded = await loadCourseWithAccess(req, res);
    if (!loaded) return;
    const { access } = loaded;
    res.json({
      success: true,
      data: { level: access.level, rank: access.rank },
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/course/:id – single course when caller has instructor+ access. */
router.get('/:id', async (req, res, next) => {
  try {
    const loaded = await loadCourseWithAccess(req, res);
    if (!loaded) return;

    const { course, access } = loaded;
    const { includeDetails = false } = req.query;

    let includeOptions = [];
    if (includeDetails === 'true') {
      includeOptions = [
        {
          model: Question_Metadata,
          as: 'questionMetadata',
          attributes: ['id', 'type', 'description', 'questionOrder'],
          include: [
            {
              model: Topics,
              as: 'primaryTopic',
              attributes: ['id', 'name'],
            },
          ],
        },
        {
          model: Topics,
          as: 'topics',
          attributes: ['id', 'name'],
        },
      ];
    }

    const courseData = includeOptions.length
      ? await Course.findByPk(course.id, { include: includeOptions })
      : course;

    res.json({
      success: true,
      data: {
        ...(courseData.toJSON ? courseData.toJSON() : courseData),
        accessLevel: access.level,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/course/:id – updates course metadata after confirming ownership. */
router.put('/:id', async (req, res, next) => {
  try {
    const { name, courseCode } = req.body;

    const courseData = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!courseData) {
      return res.status(404).json({
        success: false,
        error: 'Course not found'
      });
    }

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
});

/** DELETE /api/course/:id – removes a course and its associations if it belongs to the user. */
router.delete('/:id', async (req, res, next) => {
  try {
    const courseData = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!courseData) {
      return res.status(404).json({
        success: false,
        error: 'Course not found'
      });
    }

    await courseData.destroy();

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/course/:id/topics – topics for a course the caller may access. */
router.get('/:id/topics', async (req, res, next) => {
  try {
    const loaded = await loadCourseWithAccess(req, res);
    if (!loaded) return;

    const topics = await Topics.findAll({
      where: { courseId: loaded.course.id },
      order: [['createdAt', 'ASC']],
    });

    res.json({
      success: true,
      data: topics,
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/course/:id/topics – adds a topic to the course and pushes it to Core if the course is linked. */
router.post('/:id/topics', async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Topic name is required'
      });
    }

    // Verify user owns the course
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        error: 'Course not found'
      });
    }

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

/** PATCH /api/course/:id/link-core – stores a Core course CUID on the local course row. */
router.patch('/:id/link-core', async (req, res, next) => {
  try {
    const { coreCourseId } = req.body;

    if (!coreCourseId || typeof coreCourseId !== 'string') {
      return res.status(400).json({ success: false, error: 'coreCourseId is required' });
    }

    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const authorized = await isCoreCourseInScopedList(coreCourseId, req.headers.cookie);
    if (!authorized) {
      return res.status(403).json({ success: false, error: 'CORE_COURSE_NOT_AUTHORIZED' });
    }

    await course.update({ coreCourseId });

    res.json({ success: true, data: course });
  } catch (error) {
    next(error);
  }
});

/** POST /api/course/:id/sync-topics – pulls topics from Core and upserts them into the local topics table. */
router.post('/:id/sync-topics', async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    if (!course.coreCourseId) {
      return res.status(400).json({ success: false, error: 'Course is not linked to Core' });
    }

    let coreTopics;
    try {
      const data = await getCourseTopicsFromCore(course.coreCourseId, { cookie: req.headers.cookie });
      coreTopics = data.topics ?? data;
    } catch (coreErr) {
      return res.status(502).json({ success: false, error: coreErr.body?.error || 'Failed to fetch topics from Core' });
    }

    let synced = 0;
    for (const ct of coreTopics) {
      // Try to find existing local topic by Core ID
      let existing = await Topics.findOne({ where: { coreTopicId: ct.id } });
      if (existing) {
        await existing.update({ name: ct.name });
        synced++;
      } else {
        // Try by name+course to avoid duplicate names
        existing = await Topics.findOne({ where: { courseId: course.id, name: ct.name } });
        if (existing) {
          await existing.update({ coreTopicId: ct.id });
        } else {
          await Topics.create({ name: ct.name, courseId: course.id, coreTopicId: ct.id });
        }
        synced++;
      }
    }

    res.json({ success: true, data: { synced } });
  } catch (error) {
    next(error);
  }
});

export default router;
