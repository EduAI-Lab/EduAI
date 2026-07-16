/**
 * Router responsible for course and topic CRUD scoped to authenticated instructors.
 * Performs ownership checks before touching Sequelize models to keep tenant data isolated.
 */
import express from 'express';
import { Course, Question_Metadata, Topics } from '../schema/index.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  ensureDefaultBank,
  listBanks,
  createBank,
  updateBank,
  deleteBank,
  addQuestionToBank,
  removeQuestionFromBank
} from '../services/questionBankService.js';

const router = express.Router();

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

    // Soft-fail: Core banks require matching Core course + API key
    await ensureDefaultBank(courseData.id, req.user.id).catch((err) => {
      console.warn(
        `ensureDefaultBank skipped for new course ${courseData.id}: ${err.message}`
      );
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

/** POST /api/course/:id/topics – adds a topic to the course after validation and ownership checks. */
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

    res.status(201).json({
      success: true,
      message: 'Topic created successfully',
      data: topic
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/course/:id/banks – lists question banks for an owned course. */
router.get('/:id/banks', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    await ensureDefaultBank(course.id, req.user.id);
    const banks = await listBanks(course.id, req.user.id);
    res.json({ success: true, data: banks });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/** POST /api/course/:id/banks – creates a named question bank (via EduAI Core). */
router.post('/:id/banks', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    const bank = await createBank(course.id, req.user.id, {
      name: req.body.name,
      description: req.body.description
    });
    res.status(201).json({
      success: true,
      message: 'Question bank created successfully',
      data: bank
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/** PUT /api/course/:id/banks/:bankId – renames/updates a bank. */
router.put('/:id/banks/:bankId', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    const bank = await updateBank(course.id, req.user.id, req.params.bankId, {
      name: req.body.name,
      description: req.body.description
    });
    res.json({
      success: true,
      message: 'Question bank updated successfully',
      data: bank
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/** DELETE /api/course/:id/banks/:bankId – deletes a non-default bank. */
router.delete('/:id/banks/:bankId', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    const result = await deleteBank(course.id, req.user.id, req.params.bankId, {
      moveMembershipsToBankId: req.body?.moveMembershipsToBankId
        ? String(req.body.moveMembershipsToBankId)
        : undefined
    });
    res.json({
      success: true,
      message: 'Question bank deleted successfully',
      data: result
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/** POST /api/course/:id/banks/:bankId/questions – add question membership to a bank. */
router.post('/:id/banks/:bankId/questions', authenticateToken, async (req, res, next) => {
  try {
    const course = await Course.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!course) {
      return res.status(404).json({ success: false, error: 'Course not found' });
    }
    const questionMetadataId = Number(req.body.questionMetadataId);
    if (!Number.isInteger(questionMetadataId)) {
      return res.status(400).json({
        success: false,
        error: 'questionMetadataId is required'
      });
    }
    const result = await addQuestionToBank(
      course.id,
      req.user.id,
      req.params.bankId,
      questionMetadataId
    );
    res.status(201).json({
      success: true,
      message: 'Question added to bank',
      data: result.membership
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/** DELETE /api/course/:id/banks/:bankId/questions/:questionMetadataId – remove membership. */
router.delete(
  '/:id/banks/:bankId/questions/:questionMetadataId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const course = await Course.findOne({
        where: { id: req.params.id, userId: req.user.id }
      });
      if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' });
      }
      const result = await removeQuestionFromBank(
        course.id,
        req.user.id,
        req.params.bankId,
        Number(req.params.questionMetadataId)
      );
      res.json({
        success: true,
        message: result.reassignedToDefault
          ? 'Removed from bank; reassigned to default bank'
          : 'Removed from bank',
        data: result
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      next(error);
    }
  }
);

export default router;
