/**
 * Router for EduAI proxy endpoints, enabling chat, question generation, and metadata retrieval.
 * All routes require authentication and delegate to eduaiService for actual API interactions.
 */
import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { QM_AUTHORIZED } from '../middleware/roles.js';
import eduaiService from '../services/eduaiService.js';
import { Op } from 'sequelize';
import { Course } from '../schema/Course.js';
import { resolveAccessForCourse, LEVELS } from '../middleware/courseAccess.js';
import { normalizeCourseCode } from '../services/courseCodeUtils.js';

const router = express.Router();

/**
 * Confirm the caller has at least TA access to a QM course matching `courseCode`
 * before proxying to EduAI (#4). Resolves the local QM Course row by normalized
 * code and reuses the same access helper as the per-course middleware. Returns
 * the resolved access on success, or null when no accessible match exists.
 */
async function resolveCourseCodeAccess(reqUser, courseCode, cookie) {
  const target = normalizeCourseCode(courseCode);
  if (!target) return null;

  // Narrow with case-insensitive matches (raw + space-stripped forms) so common
  // code variations hit the index, then normalize-compare in JS to collapse any
  // remaining whitespace differences (mirrors findScopedCoreCourseByCode).
  const compact = courseCode.replace(/\s+/g, '');
  const candidates = await Course.findAll({
    where: { code: { [Op.or]: [{ [Op.iLike]: courseCode }, { [Op.iLike]: compact }] } },
  }).catch(() => []);
  const matches = candidates.filter((c) => normalizeCourseCode(c.code) === target);
  for (const course of matches) {
    const access = await resolveAccessForCourse(reqUser, course, { cookie });
    if (access && access.rank >= LEVELS.ta.rank) return access;
  }
  return null;
}

router.use(authenticateToken, requireRole(QM_AUTHORIZED));

/** POST /api/eduai/chat – proxies streaming chat prompts to EduAI with the given course code. */
router.post('/chat', async (req, res) => {
  try {
    const { messages, model, apiKeys, courseCode, streaming } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    if (!courseCode) {
      return res.status(400).json({ error: 'Course code is required' });
    }

    // Confirm the caller actually has access to this course in QM before
    // proxying (#4) — the client-supplied courseCode is otherwise unverified.
    const access = await resolveCourseCodeAccess(req.user, courseCode, req.headers.cookie);
    if (!access) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this course',
        code: 'COURSE_ACCESS_DENIED'
      });
    }

    const course = {
      id: 0,
      name: `EduAI Course: ${courseCode}`,
      code: courseCode
    };

    // Call EduAI service
    const response = await eduaiService.chat({
      messages,
      model: model || 'google:gemini-2.5-flash',
      apiKeys: apiKeys || {},
      courseCode,
      streaming: streaming || false
    });

    res.json({
      success: true,
      data: response,
      course: {
        id: course.id,
        name: course.name,
        code: course.code
      }
    });
  } catch (error) {
    console.error('EduAI chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message 
    });
  }
});

/** POST /api/eduai/generate-questions – requests generated questions from EduAI using the provided prompt and options. */
router.post('/generate-questions', async (req, res) => {
  try {
    const { 
      prompt, 
      courseCode, 
      model, 
      apiKeys, 
      numQuestions, 
      difficultyDistribution,
      reasoningDistribution,
      mcqRequiredChoiceCount
    } = req.body;

    // Validate required fields
    if (!prompt || !courseCode) {
      return res.status(400).json({
        error: 'Prompt and course code are required'
      });
    }

    // Confirm the caller actually has access to this course in QM before
    // proxying (#4) — the client-supplied courseCode is otherwise unverified.
    const access = await resolveCourseCodeAccess(req.user, courseCode, req.headers.cookie);
    if (!access) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this course',
        code: 'COURSE_ACCESS_DENIED'
      });
    }

    const course = {
      id: 0,
      name: `EduAI Course: ${courseCode}`,
      code: courseCode
    };

    // Call EduAI service to generate questions
    const mcqN =
      mcqRequiredChoiceCount != null && Number.isFinite(Number(mcqRequiredChoiceCount))
        ? Math.min(26, Math.max(2, Math.floor(Number(mcqRequiredChoiceCount))))
        : undefined;

    const questions = await eduaiService.generateQuestions({
      prompt,
      courseCode,
      model: model || 'google:gemini-2.5-flash',
      apiKeys: apiKeys || {},
      numQuestions: numQuestions || 5,
      difficultyDistribution: difficultyDistribution || { easy: 1, medium: 2, hard: 2 },
      reasoningDistribution: reasoningDistribution || { factual: 40, analytical: 30, application: 30 },
      ...(mcqN != null ? { mcqRequiredChoiceCount: mcqN } : {})
    });

    res.json({
      success: true,
      data: {
        questions,
        count: questions.length,
        course: {
          id: course.id,
          name: course.name,
          code: course.code
        }
      }
    });
  } catch (error) {
    console.error('EduAI question generation error:', error);
    // If the error message is from the AI (contains detailed reason), use it as the main error
    // Otherwise, use a generic message with details
    const errorMessage = error.message || 'Failed to generate questions';
    const isAiError = errorMessage && !errorMessage.includes('EduAI question generation failed:');
    
    res.status(500).json({ 
      error: isAiError ? errorMessage : 'Failed to generate questions',
      details: errorMessage,
      aiErrorReason: isAiError ? errorMessage : undefined
    });
  }
});

/** GET /api/eduai/courses – fetches the list of EduAI-managed courses for selection. */
router.get('/courses', async (req, res) => {
  try {
    const coursesData = await eduaiService.listCourses();

    res.json({
      success: true,
      data: coursesData
    });
  } catch (error) {
    console.error('EduAI list courses error:', error);
    res.status(500).json({
      error: 'Failed to retrieve courses from EduAI',
      details: error.message
    });
  }
});

/** GET /api/eduai/courses/:courseId/topics – retrieves EduAI topics for the given course ID. */
router.get('/courses/:courseId/topics', async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    const topics = await eduaiService.getCourseTopics(courseId);

    res.json({
      success: true,
      data: topics
    });
  } catch (error) {
    console.error('EduAI course topics error:', error);
    res.status(500).json({
      error: 'Failed to retrieve topics from EduAI',
      details: error.message
    });
  }
});

/**
 * POST /api/eduai/test-api-key – validates AI connectivity. Accepts an optional
 * `apiKeys` body carrying the caller's browser-stored provider keys (e.g. Google)
 * so the check validates the cloud provider rather than the (possibly offline)
 * UBC-hosted provider. Echoes back `provider` so the UI can report which path is live.
 */
router.post('/test-api-key', async (req, res) => {
  try {
    const result = await eduaiService.testApiKey({
      cookie: req.headers.cookie ?? '',
      apiKeys: req.body?.apiKeys ?? {},
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        provider: result.provider,
        data: result.response
      });
    } else {
      res.status(400).json({
        success: false,
        provider: result.provider,
        error: result.error,
        statusCode: result.statusCode
      });
    }
  } catch (error) {
    console.error('EduAI API key test error:', error);
    res.status(500).json({
      error: 'Failed to test EduAI API key',
      details: error.message
    });
  }
});

/**
 * Minimal cloud/local model catalog used when EduAI Core's model list is
 * unreachable. Lets the picker stay usable (especially the cloud Google model,
 * which only needs the caller's own API key) instead of rendering empty.
 */
const FALLBACK_AI_MODELS = [
  {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Cloud model — uses your own Google API key.',
    isActive: true,
  },
  {
    provider: 'ollama',
    modelId: 'gpt-oss:120b',
    name: 'GPT-OSS 120B (UBC hosted)',
    description: 'UBC-hosted model. Requires UBC network/VPN.',
    isActive: true,
  },
];

/** GET /api/eduai/ai-models – returns the available AI model identifiers from EduAI. */
router.get('/ai-models', async (req, res) => {
  try {
    const models = await eduaiService.listAIModels({ cookie: req.headers.cookie ?? '' });
    if (Array.isArray(models) && models.length > 0) {
      return res.json(models);
    }
    // Core catalog empty/unreachable — fall back to a minimal list so the picker
    // stays usable (the cloud model works with the caller's own provider key).
    console.warn('EduAI model list empty — serving fallback catalog. Check Core session or EDUAI_API_KEY');
    return res.json(FALLBACK_AI_MODELS);
  } catch (error) {
    console.error('EduAI list models error:', error);
    // Auth failures are the caller's problem to fix; surface them. For any other
    // failure, degrade gracefully to the fallback catalog rather than an empty picker.
    if (error.status === 401 || error.status === 403) {
      return res.status(error.status).json({
        error: 'Failed to retrieve AI models from EduAI',
        details: error.message,
      });
    }
    return res.json(FALLBACK_AI_MODELS);
  }
});

export default router;
