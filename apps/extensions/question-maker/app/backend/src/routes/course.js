/**
 * Router responsible for course and topic CRUD scoped to authenticated instructors.
 * Performs ownership checks before touching Sequelize models to keep tenant data isolated.
 */
import express from 'express';
import { Course, Question_Metadata, Topics } from '../schema/index.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  getCourseTopicsFromCore,
  pushTopicToCore,
  isCoreCourseInScopedList,
  findScopedCoreCourseByCode,
} from '../services/coreApiService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/** Links a local course to Core when code matches an enrolled Core course (#578). */
async function ensureCoreCourseLink(course, cookie) {
  if (course.coreCourseId) return false;

  try {
    const match = await findScopedCoreCourseByCode(course.code, cookie);
    if (match?.id) {
      await course.update({ coreCourseId: match.id });
      logger.info(
        { courseId: course.id, coreCourseId: match.id, code: course.code },
        'Auto-linked local course to Core by code'
      );
      return true;
    }
  } catch (err) {
    logger.warn({ err, courseId: course.id }, 'Core course auto-link skipped');
  }

  return false;
}

/** Upserts Core course topics into the local QM topics table. */
async function syncTopicsFromCoreForCourse(course, cookie) {
  if (!course?.coreCourseId) return 0;

  let coreTopics;
  try {
    const data = await getCourseTopicsFromCore(course.coreCourseId, { cookie });
    coreTopics = Array.isArray(data?.topics) ? data.topics : Array.isArray(data) ? data : [];
  } catch (err) {
    logger.warn({ err, coreCourseId: course.coreCourseId }, 'Core topic sync skipped');
    return 0;
  }

  let synced = 0;
  for (const ct of coreTopics) {
    if (!ct?.id || !ct?.name) continue;

    let existing = await Topics.findOne({ where: { coreTopicId: ct.id } });
    if (existing) {
      if (existing.courseId !== course.id) continue;
      await existing.update({ name: ct.name });
      synced++;
      continue;
    }

    existing = await Topics.findOne({ where: { courseId: course.id, name: ct.name } });
    if (existing) {
      await existing.update({ coreTopicId: ct.id });
    } else {
      await Topics.create({ name: ct.name, courseId: course.id, coreTopicId: ct.id });
    }
    synced++;
  }

  return synced;
}

/** POST /api/course – creates a course tied to the authenticated user after basic validation. */
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

/** GET /api/course – lists the user’s courses and optionally includes question/topic stats. */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { includeStats = false } = req.query;
    
    let includeOptions = [];
    if (includeStats === 'true') {
      includeOptions = [
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
      ];
    }

    const courses = await Course.findAll({
      where: { userId: req.user.id },
      include: includeOptions,
      order: [['createdAt', 'DESC']]
    });

    // Add stats if requested
    if (includeStats === 'true') {
      const coursesWithStats = courses.map(course => ({
        ...course.toJSON(),
        stats: {
          totalQuestions: course.questionMetadata?.length || 0,
          totalTopics: course.topics?.length || 0,
          questionTypes: course.questionMetadata?.reduce((acc, q) => {
            acc[q.type] = (acc[q.type] || 0) + 1;
            return acc;
          }, {}) || {}
        }
      }));
      
      return res.json({
        success: true,
        data: coursesWithStats
      });
    }

    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/course/:id – fetches a single course with optional details if the requester owns it. */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
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
              attributes: ['id', 'name']
            }
          ]
        },
        {
          model: Topics,
          as: 'topics',
          attributes: ['id', 'name']
        }
      ];
    }

    const courseData = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: includeOptions
    });

    if (!courseData) {
      return res.status(404).json({
        success: false,
        error: 'Course not found'
      });
    }

    res.json({
      success: true,
      data: courseData
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/course/:id – updates course metadata after confirming ownership. */
router.put('/:id', authenticateToken, async (req, res, next) => {
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
router.delete('/:id', authenticateToken, async (req, res, next) => {
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

/** GET /api/course/:id/topics – returns the topic list for an owned course. */
router.get('/:id/topics', authenticateToken, async (req, res, next) => {
  try {
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

/** POST /api/course/:id/topics – adds a topic to the course and pushes it to Core if the course is linked. */
router.post('/:id/topics', authenticateToken, async (req, res, next) => {
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
router.patch('/:id/link-core', authenticateToken, async (req, res, next) => {
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

/** POST /api/course/:id/sync-topics – pulls topics from Core and upserts them into the local topics table. */
router.post('/:id/sync-topics', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }

    const cookie = req.headers.cookie ?? '';
    if (await ensureCoreCourseLink(course, cookie)) {
      await course.reload();
    }

    if (!course.coreCourseId) {
      return res.status(400).json({ success: false, error: 'Course is not linked to Core' });
    }

    const synced = await syncTopicsFromCoreForCourse(course, cookie);

    res.json({ success: true, data: { synced } });
  } catch (error) {
    next(error);
  }
});

export default router;
