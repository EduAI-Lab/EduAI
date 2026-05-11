/**
 * Canvas router exposing endpoints for connecting accounts, exporting assessments, and importing quizzes.
 * Wraps canvasService calls with authentication and payload validation for Canvas integration workflows.
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
  importQuizFromCanvas
} from '../services/canvasService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/** GET /api/canvas/integration – returns whether the user has Canvas configured (without exposing the API key). */
router.get('/integration', authenticateToken, async (req, res, next) => {
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

/** POST /api/canvas/connect – stores Canvas credentials/test-mode flag after validating payload. */
router.post('/connect', authenticateToken, async (req, res, next) => {
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

/** DELETE /api/canvas/disconnect – removes the saved Canvas integration for the user. */
router.delete('/disconnect', authenticateToken, async (req, res, next) => {
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

/** GET /api/canvas/courses – lists Canvas courses available via the integration helper. */
router.get('/courses', authenticateToken, async (req, res, next) => {
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

/** POST /api/canvas/export/:assessmentId – exports an assessment's questions to the specified Canvas course. */
router.post('/export/:assessmentId', authenticateToken, async (req, res, next) => {
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
      canvasCourseId
    );

    res.json({
      success: true,
      message: 'Assessment exported to Canvas successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/canvas/mapping/:courseId – returns stored mapping between a local course and Canvas course. */
router.get('/mapping/:courseId', authenticateToken, async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const mapping = await getCanvasCourseMapping(req.user.id, courseId);

    res.json({
      success: true,
      data: mapping
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/canvas/courses/:canvasCourseId/quizzes – fetches quizzes from a Canvas course via the API. */
router.get('/courses/:canvasCourseId/quizzes', authenticateToken, async (req, res, next) => {
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

/** GET /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions – lists Canvas quiz questions for review/import. */
router.get('/courses/:canvasCourseId/quizzes/:quizId/questions', authenticateToken, async (req, res, next) => {
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

/** POST /api/canvas/import/:canvasCourseId/quizzes/:quizId – imports a Canvas quiz into a local assessment and course. */
router.post('/import/:canvasCourseId/quizzes/:quizId', authenticateToken, async (req, res, next) => {
  try {
    const { canvasCourseId, quizId } = req.params;
    const { localCourseId, assessmentType, assessmentName, semester, primaryTopicId } = req.body;

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

    const result = await importQuizFromCanvas(
      req.user.id,
      canvasCourseId,
      quizId,
      localCourseId,
      {
        assessmentType,
        assessmentName,
        semester,
        primaryTopicId
      }
    );

    res.json({
      success: true,
      message: 'Quiz imported from Canvas successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

export default router;
