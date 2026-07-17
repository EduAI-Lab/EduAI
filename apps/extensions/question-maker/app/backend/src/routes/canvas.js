/**
 * Canvas router: connect/get/disconnect a personal Canvas integration, browse
 * Canvas content, and export/import assessments.
 *
 * RBAC (rbac-matrix.md §18, issue #314):
 *  - canvas_integrations are PERSONAL (own-only, `O`): role-gated to
 *    ADMIN / UNIT_ADMIN / INSTRUCTOR and always scoped to `req.user.id`.
 *  - canvas_course_mappings + export/import are course-scoped (`C`/`D`):
 *    instructor-and-up access to the local course; mappings are keyed to the
 *    course owner (`req.qmCourse.userId`) while the personal Canvas creds remain
 *    the caller's (`req.user.id`). TA / STUDENT are rejected.
 */
import express from 'express';
import {
  getCanvasIntegration,
  saveCanvasIntegration,
  getCanvasCourses,
  exportAssessmentToCanvas,
  getCanvasCourseMapping,
  getCanvasQuizzes,
  getCanvasQuizQuestions,
  importQuizFromCanvas,
  getCanvasQuestionBanks,
  getCanvasQuestionBankQuestions,
  importQuestionBankFromCanvas
} from '../services/canvasService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { CANVAS_ROLES } from '../middleware/roles.js';
import { requireCourseAccess } from '../middleware/courseAccess.js';
import { requireAssessmentAccess } from '../middleware/resourceAccess.js';
import { Topics } from '../schema/index.js';

const router = express.Router();

/** GET /api/canvas/integration – returns whether the caller has Canvas configured (own, no key exposed). */
router.get('/integration', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const integration = await getCanvasIntegration(req.user.id);

    if (!integration) {
      return res.json({
        success: true,
        data: null,
        message: 'Canvas integration not configured'
      });
    }

    // Don't send API key in response
    res.json({
      success: true,
      data: {
        canvasUrl: integration.canvasUrl,
        isTestMode: integration.isTestMode,
        isConnected: true
      }
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/canvas/connect – stores the caller's Canvas credentials/test-mode flag. */
router.post('/connect', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const { canvasUrl, apiKey, isTestMode } = req.body;

    if (!canvasUrl) {
      return res.status(400).json({
        success: false,
        error: 'Canvas URL is required'
      });
    }

    // In test mode, API key is optional
    if (!isTestMode && !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required (unless using test mode)'
      });
    }

    // Validate URL format
    try {
      new URL(canvasUrl);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Canvas URL format'
      });
    }

    const integration = await saveCanvasIntegration(req.user.id, {
      canvasUrl,
      apiKey: apiKey || 'test-key', // Use placeholder in test mode
      isTestMode: isTestMode || false
    });

    res.json({
      success: true,
      message: isTestMode
        ? 'Canvas test mode enabled. You can test exports without a real Canvas account.'
        : 'Canvas integration connected successfully',
      data: {
        canvasUrl: integration.canvasUrl,
        isTestMode: integration.isTestMode
      }
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/canvas/disconnect – removes the caller's saved Canvas integration. */
router.delete('/disconnect', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const integration = await getCanvasIntegration(req.user.id);

    if (integration) {
      await integration.destroy();
    }

    res.json({
      success: true,
      message: 'Canvas integration disconnected'
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/canvas/courses – lists Canvas courses via the caller's integration. */
router.get('/courses', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const courses = await getCanvasCourses(req.user.id);

    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/canvas/export/:assessmentId – exports an assessment to Canvas (course-scoped, instructor-only). */
router.post(
  '/export/:assessmentId',
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireAssessmentAccess({ min: 'instructor', param: 'assessmentId' }),
  async (req, res, next) => {
    try {
      const { assessmentId } = req.params;
      const { canvasCourseId } = req.body;

      if (!canvasCourseId) {
        return res.status(400).json({
          success: false,
          error: 'Canvas course ID is required'
        });
      }

      const result = await exportAssessmentToCanvas(
        req.user.id,
        assessmentId,
        canvasCourseId,
        req.qmCourse.userId
      );

      res.json({
        success: true,
        message: 'Assessment exported to Canvas successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/canvas/mapping/:courseId – returns the stored mapping (course-scoped, instructor-only). */
router.get(
  '/mapping/:courseId',
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireCourseAccess({ min: 'instructor', getCourseId: (req) => req.params.courseId }),
  async (req, res, next) => {
    try {
      const mapping = await getCanvasCourseMapping(req.qmCourse.userId, req.qmCourse.id);

      res.json({
        success: true,
        data: mapping
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/canvas/courses/:canvasCourseId/quizzes – fetches quizzes from a Canvas course. */
router.get('/courses/:canvasCourseId/quizzes', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const { canvasCourseId } = req.params;
    const quizzes = await getCanvasQuizzes(req.user.id, canvasCourseId);

    res.json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions – lists Canvas quiz questions. */
router.get('/courses/:canvasCourseId/quizzes/:quizId/questions', authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const { canvasCourseId, quizId } = req.params;
    const questions = await getCanvasQuizQuestions(req.user.id, canvasCourseId, quizId);

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/canvas/import/:canvasCourseId/quizzes/:quizId – imports a Canvas quiz (course-scoped, instructor-only). */
router.post(
  '/import/:canvasCourseId/quizzes/:quizId',
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireCourseAccess({ min: 'instructor', getCourseId: (req) => req.body.localCourseId }),
  async (req, res, next) => {
    try {
      const { canvasCourseId, quizId } = req.params;
      const { assessmentType, assessmentName, semester, primaryTopicId } = req.body;

      if (!primaryTopicId) {
        return res.status(400).json({
          success: false,
          error: 'Primary topic ID is required for importing questions'
        });
      }

      // Eagerly confirm the topic exists and belongs to this course before
      // creating questions — otherwise the FK insert crashes mid-import (#7). A
      // supplied-but-nonexistent topic is a missing resource, so 404 (#3).
      const topic = await Topics.findOne({
        where: { id: primaryTopicId, courseId: req.qmCourse.id }
      });
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: 'Primary topic not found in this course'
        });
      }

      const result = await importQuizFromCanvas(
        req.user.id,
        canvasCourseId,
        quizId,
        req.qmCourse.id,
        {
          assessmentType,
          assessmentName,
          semester,
          primaryTopicId
        },
        req.qmCourse.userId
      );

      res.json({
        success: true,
        message: 'Quiz imported from Canvas successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/canvas/courses/:canvasCourseId/banks – lists Canvas Assessment Question Banks. */
router.get('/courses/:canvasCourseId/banks', authenticateToken, async (req, res, next) => {
  try {
    const banks = await getCanvasQuestionBanks(req.user.id, req.params.canvasCourseId);
    res.json({ success: true, data: banks });
  } catch (error) {
    next(error);
  }
});

/** GET /api/canvas/courses/:canvasCourseId/banks/:canvasBankId/questions – lists bank questions. */
router.get(
  '/courses/:canvasCourseId/banks/:canvasBankId/questions',
  authenticateToken,
  async (req, res, next) => {
    try {
      const questions = await getCanvasQuestionBankQuestions(
        req.user.id,
        req.params.canvasBankId
      );
      res.json({ success: true, data: questions });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/canvas/import/:canvasCourseId/banks/:canvasBankId – sync Canvas bank into local course. */
router.post(
  '/import/:canvasCourseId/banks/:canvasBankId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { canvasCourseId, canvasBankId } = req.params;
      const { localCourseId, primaryTopicId, targetBankId } = req.body;

      if (!localCourseId) {
        return res.status(400).json({
          success: false,
          error: 'Local course ID is required'
        });
      }
      if (!primaryTopicId) {
        return res.status(400).json({
          success: false,
          error: 'Primary topic ID is required for importing questions'
        });
      }

      const result = await importQuestionBankFromCanvas(
        req.user.id,
        canvasCourseId,
        canvasBankId,
        localCourseId,
        { primaryTopicId, targetBankId, cookieHeader: req.headers.cookie }
      );

      res.json({
        success: true,
        message: 'Question bank synced from Canvas successfully',
        data: result
      });
    } catch (error) {
      if (error.status === 404 || error.status === 400) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      next(error);
    }
  }
);

export default router;
