/**
 * Router for question management endpoints including CRUD, statistics, AI generation, and extraction workflows.
 * All routes are authenticated and delegate to questionService/aiService helpers for business logic.
 */
import express from 'express';
import {
  createQuestion,
  getQuestionsByUser,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  createMultipleQuestions,
  getQuestionStats,
  updateQuestionOrder,
  removeQuestionFromAssessment,
  saveExtractedQuestions
} from '../services/questionService.js';
import { generateQuestions, AI_PROVIDERS, extractQuestionsFromText } from '../services/aiService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/** POST /api/questions – validates payload and creates a new question for the user. */
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const rawDescription = req.body.description ?? req.body.content;
    const rawCourseId = req.body.courseId ?? req.body.classId;
    const rawPrimaryTopicId = req.body.primaryTopicId;
    const type = req.body.type || 'MCQ';
    const questionOrder = req.body.questionOrder;
    const isAiGenerated = req.body.isAiGenerated;
    const isDraft = req.body.isDraft;

    const allowedTypes = ['MCQ', 'SA', 'LA'];
    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid question type. Allowed values: ${allowedTypes.join(', ')}`
      });
    }

    const description = typeof rawDescription === 'string' && rawDescription.trim()
      ? rawDescription.trim()
      : null;

    const courseId = Number(rawCourseId);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({
        success: false,
        error: 'Valid courseId is required'
      });
    }

    const primaryTopicId = Number(rawPrimaryTopicId);
    if (!Number.isInteger(primaryTopicId)) {
      return res.status(400).json({
        success: false,
        error: 'Valid primaryTopicId is required'
      });
    }

    const question = await createQuestion(req.user.id, {
      description,
      courseId,
      primaryTopicId,
      type,
      questionOrder,
      isAiGenerated,
      isDraft
    });

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions – paginated list of questions scoped to the authenticated user. */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { courseId, classId, search, limit, offset } = req.query;
    const requestedCourseId = courseId ?? classId;
    const normalizedCourseId = requestedCourseId === undefined || requestedCourseId === '' ? undefined : requestedCourseId;

    const questions = await getQuestionsByUser(req.user.id, {
      courseId: normalizedCourseId,
      search,
      limit,
      offset
    });

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions/stats – returns aggregate stats (counts, types) for the user’s question bank. */
router.get('/stats', authenticateToken, async (req, res, next) => {
  try {
    const stats = await getQuestionStats(req.user.id);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions/:id – fetches a single question after verifying ownership. */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id, req.user.id);

    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/questions/:id – updates question metadata/type/order flags, enforcing validation rules. */
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { description, content, courseId, classId, type, primaryTopicId, questionOrder, isAiGenerated, isDraft } = req.body; //mock for AI generated questions

    const updates = {};

    if (description !== undefined || content !== undefined) {
      const value = (description ?? content ?? '').trim();
      updates.description = value || null;
    }

    if (courseId !== undefined || classId !== undefined) {
      const resolvedCourseId = Number(courseId ?? classId);
      if (!Number.isInteger(resolvedCourseId)) {
        return res.status(400).json({
          success: false,
          error: 'Valid courseId is required'
        });
      }
      updates.courseId = resolvedCourseId;
    }

    if (primaryTopicId !== undefined) {
      const resolvedTopicId = Number(primaryTopicId);
      if (!Number.isInteger(resolvedTopicId)) {
        return res.status(400).json({
          success: false,
          error: 'Valid primaryTopicId is required'
        });
      }
      updates.primaryTopicId = resolvedTopicId;
    }

    if (type !== undefined) {
      const allowedTypes = ['MCQ', 'SA', 'LA'];
      if (!allowedTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid question type. Allowed values: ${allowedTypes.join(', ')}`
        });
      }
      updates.type = type;
    }

    if (questionOrder !== undefined) {
      updates.questionOrder = questionOrder;
    }

    if (isAiGenerated !== undefined) {
      updates.isAiGenerated = Boolean(isAiGenerated);
    }

    if (isDraft !== undefined) {
      updates.isDraft = Boolean(isDraft);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields provided to update'
      });
    }

    const question = await updateQuestion(req.params.id, req.user.id, updates);

    res.json({
      success: true,
      message: 'Question updated successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/questions/:id – removes a question owned by the authenticated user. */
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await deleteQuestion(req.params.id, req.user.id);

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/questions/generate – triggers legacy AI providers to generate draft questions. */
router.post('/generate', authenticateToken, async (req, res, next) => {
  try {
    const { prompt, provider = AI_PROVIDERS.GROQ, numQuestions = 15, difficultyDistribution } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const params = {
      numQuestions: parseInt(numQuestions) || 15,
      difficultyDistribution: difficultyDistribution || {
        easy: 5,
        medium: 5,
        hard: 5
      }
    };

    const questions = await generateQuestions(prompt.trim(), provider, params);

    res.json({
      success: true,
      message: 'Questions generated successfully',
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/questions/extract – sends OCR text to the AI extraction service and returns proposed questions. */
router.post('/extract', authenticateToken, async (req, res, next) => {
  try {
    const { text, courseId, model, apiKeys } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Text content is required for extraction'
      });
    }

    if (courseId === undefined || courseId === null || courseId === '') {
      return res.status(400).json({
        success: false,
        error: 'courseId is required to assign topics'
      });
    }

    const numericCourseId = Number(courseId);
    if (!Number.isInteger(numericCourseId)) {
      return res.status(400).json({
        success: false,
        error: 'courseId must be a valid integer'
      });
    }

    const questions = await extractQuestionsFromText(text, numericCourseId, model, apiKeys);

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/questions/extract/save – persists selected extracted questions (optionally tying them to an assessment). */
router.post('/extract/save', authenticateToken, async (req, res, next) => {
  try {
    const { courseId, primaryTopicId, topicName, questions, assessment } = req.body;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'courseId is required'
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one question is required'
      });
    }

    const saved = await saveExtractedQuestions(req.user.id, {
      courseId: Number(courseId),
      primaryTopicId: primaryTopicId !== undefined && primaryTopicId !== null && primaryTopicId !== ''
        ? Number(primaryTopicId)
        : undefined,
      topicName,
      questions,
      assessment
    });

    res.status(201).json({
      success: true,
      message: `${saved.length} question${saved.length === 1 ? '' : 's'} saved successfully`,
      data: saved
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/questions/approve – bulk saves approved generated questions into the question bank. */
router.post('/approve', authenticateToken, async (req, res, next) => {
  try {
    const { questions, courseId, classId } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Questions array is required'
      });
    }

    const normalizedQuestions = questions.map((q) => {
      const candidateCourseId = q.courseId ?? q.classId ?? courseId ?? classId;
      const desc = q.description ?? q.content;
      return {
        description: typeof desc === 'string' && desc.trim() ? desc.trim() : null,
        courseId: candidateCourseId === '' ? undefined : candidateCourseId,
        primaryTopicId: q.primaryTopicId ?? 1,
        type: q.type,
        questionOrder: q.questionOrder
      };
    });

    const invalid = normalizedQuestions.find(
      (q) => q.courseId === undefined || q.courseId === null
    );

    if (invalid) {
      return res.status(400).json({
        success: false,
        error: 'Each question must include courseId and primaryTopicId'
      });
    }

    const savedQuestions = await createMultipleQuestions(req.user.id, normalizedQuestions);

    res.status(201).json({
      success: true,
      message: `${savedQuestions.length} questions saved successfully`,
      data: savedQuestions
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/questions/:id/order – updates an assessment-specific order value for the question. */
router.put('/:id/order', authenticateToken, async (req, res, next) => {
  try {
    const { assessmentId, orderNumber } = req.body;

    if (!assessmentId || orderNumber === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Assessment ID and order number are required'
      });
    }

    const question = await updateQuestionOrder(
      req.params.id, 
      assessmentId, 
      orderNumber, 
      req.user.id
    );

    res.json({
      success: true,
      message: 'Question order updated successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/questions/:id/order/:assessmentId – removes a question from an assessment’s ordering. */
router.delete('/:id/order/:assessmentId', authenticateToken, async (req, res, next) => {
  try {
    const question = await removeQuestionFromAssessment(
      req.params.id, 
      req.params.assessmentId, 
      req.user.id
    );

    res.json({
      success: true,
      message: 'Question removed from assessment order',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

export default router;
