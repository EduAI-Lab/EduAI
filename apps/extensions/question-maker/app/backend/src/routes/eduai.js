/**
 * Router for EduAI proxy endpoints, enabling chat, question generation, and metadata retrieval.
 * All routes require authentication and delegate to eduaiService for actual API interactions.
 */
import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { QM_AUTHORIZED } from '../middleware/roles.js';
import eduaiService from '../services/eduaiService.js';
import { resolveAccessForCourse, LEVELS } from '../middleware/courseAccess.js';
import { findCoursesByProjectedCode, listCoursesForUser } from '../services/courseListService.js';
import { prisma } from '../config/database.js';
import { safeRequestLogFields } from '../utils/safeLogging.js';
import {
  qmAiUserRateLimit,
  qmAiProviderCallAdmission,
  validateChatAdmission,
  validateTestApiKeyAdmission,
  validateGenerationBudget,
  isQmAiDeadlineError,
  assertQmAiDeadline,
} from '../middleware/aiAdmission.js';

const router = express.Router();

/**
 * Confirm the caller has at least TA access to a QM course matching `courseCode`
 * before proxying to EduAI (#4). `code` is Core-owned and no longer stored
 * locally (#1072 §4 step 10), so the match reads through Core via
 * `findCoursesByProjectedCode` rather than querying a local `code` column.
 * Reuses the same access helper as the per-course middleware. Returns
 * `{ course, access }` on success, or null when no accessible match exists.
 */
async function resolveCourseCodeAccess(reqUser, courseCode, cookie, signal) {
  const matches = await findCoursesByProjectedCode(courseCode, { signal });
  assertQmAiDeadline({ signal });
  for (const course of matches) {
    const access = await resolveAccessForCourse(reqUser, course, { cookie, signal });
    assertQmAiDeadline({ signal });
    if (access && access.rank >= LEVELS.ta.rank) return { course, access };
  }
  return null;
}

/** Resolve a Core course id only through a locally anchored QM course + live access. */
async function resolveCoreCourseAccess(reqUser, coreCourseId, cookie, signal) {
  if (typeof coreCourseId !== 'string' || !coreCourseId.trim()) return null;
  const courses = await prisma.course.findMany({
    where: { coreCourseId: coreCourseId.trim() },
  });
  for (const course of courses) {
    const access = await resolveAccessForCourse(reqUser, course, { cookie, signal });
    assertQmAiDeadline({ signal });
    if (access && access.rank >= LEVELS.ta.rank) return { course, access };
  }
  return null;
}

/** Keep the catalog response Core-shaped without exposing unrelated QM rows. */
function projectVisibleCourse(course) {
  if (!course?.coreCourseId) return null;
  return {
    id: course.coreCourseId,
    name: course.name ?? null,
    code: course.code ?? null,
    department: course.department ?? null,
    term: course.term ?? null,
    year: course.year ?? null,
    description: course.description ?? null,
    isPublished: course.isPublished ?? null,
  };
}

function logEduaiRouteError(event, error) {
  // Upstream messages/bodies can contain prompts, keys, or provider details.
  console.error(event, safeRequestLogFields(error));
}

router.use(authenticateToken, requireRole(QM_AUTHORIZED));

const chatAdmission = qmAiProviderCallAdmission({
  validate: validateChatAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

const testApiKeyAdmission = qmAiProviderCallAdmission({
  validate: validateTestApiKeyAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

function sendStableAiFailure(res, error, fallbackCode, fallbackMessage) {
  const statusCode = Number(error?.statusCode ?? error?.status);
  if (statusCode === 429) {
    return res.status(429).json({
      success: false,
      error: 'AI provider rate limit exceeded; try again later',
      code: 'EDUAI_UPSTREAM_RATE_LIMITED',
    });
  }
  if (isQmAiDeadlineError(error) || statusCode === 504) {
    return res.status(504).json({
      success: false,
      error: 'AI operation timed out; try again later',
      code: 'QM_AI_OPERATION_DEADLINE',
    });
  }
  return res.status(500).json({ success: false, error: fallbackMessage, code: fallbackCode });
}

/** POST /api/eduai/chat – proxies streaming chat prompts to EduAI with the given course code. */
router.post('/chat', qmAiUserRateLimit, chatAdmission, async (req, res) => {
  try {
    const { model, apiKeys, streaming } = req.body;
    const { messages } = req.aiAdmission;
    const courseCode = typeof req.body.courseCode === 'string' ? req.body.courseCode.trim() : '';

    // Confirm the caller actually has access to this course in QM before
    // proxying (#4) — the client-supplied courseCode is otherwise unverified.
    const resolved = await resolveCourseCodeAccess(req.user, courseCode, req.headers.cookie, req.aiOperation?.signal);
    if (!resolved) {
      return res.status(403).json({
        success: false,
        error: "You do not have access to this course",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const { course: qmCourse } = resolved;
    const resolvedCourseCode = (qmCourse.code && qmCourse.code.trim()) || courseCode;
    const coreCourseId =
      typeof qmCourse.coreCourseId === "string" && qmCourse.coreCourseId.trim()
        ? qmCourse.coreCourseId.trim()
        : undefined;

    // Call EduAI service — prefer Core courseId when the QM course is linked.
    const response = await eduaiService.chat({
      messages,
      model: model || "google:gemini-2.5-flash",
      apiKeys: apiKeys || {},
      courseId: coreCourseId,
      courseCode: resolvedCourseCode,
      streaming: streaming || false,
      cookie: req.headers.cookie ?? '',
      signal: req.aiOperation?.signal,
      deadlineAt: req.aiOperation?.deadlineAt,
    });

    res.json({
      success: true,
      data: response,
      course: {
        id: qmCourse.id,
        name: qmCourse.name,
        code: resolvedCourseCode,
        coreCourseId: coreCourseId ?? null,
      },
    });
  } catch (error) {
    logEduaiRouteError('EduAI chat error', error);
    if (Number(error?.statusCode ?? error?.status) === 429 || isQmAiDeadlineError(error) || Number(error?.statusCode ?? error?.status) === 504) {
      return sendStableAiFailure(res, error, 'EDUAI_CHAT_FAILED', 'Failed to process chat request');
    }
    res.status(500).json({ success: false, error: 'Failed to process chat request', code: 'EDUAI_CHAT_FAILED' });
  }
});

/** POST /api/eduai/generate-questions – requests generated questions from EduAI using the provided prompt and options. */
router.post('/generate-questions', qmAiUserRateLimit, async (req, res) => {
  try {
    const {
      prompt,
      courseCode,
      model,
      apiKeys,
      numQuestions,
      difficultyDistribution,
      reasoningDistribution,
      mcqRequiredChoiceCount,
    } = req.body;

    // Validate required fields and apply the same prompt/count budget as the
    // legacy provider endpoint before resolving a course or calling EduAI.
    const budget = validateGenerationBudget({ prompt, numQuestions });
    if (budget.status) {
      return res.status(budget.status).json({
        success: false,
        error: budget.message,
        code: budget.code,
      });
    }

    if (!courseCode) {
      return res.status(400).json({
        error: 'Prompt and course code are required'
      });
    }

    // Confirm the caller actually has access to this course in QM before
    // proxying (#4) — the client-supplied courseCode is otherwise unverified.
    const resolved = await resolveCourseCodeAccess(req.user, courseCode, req.headers.cookie, req.aiOperation?.signal);
    if (!resolved) {
      return res.status(403).json({
        success: false,
        error: "You do not have access to this course",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const { course: qmCourse } = resolved;
    const resolvedCourseCode = (qmCourse.code && qmCourse.code.trim()) || courseCode;
    const coreCourseId =
      typeof qmCourse.coreCourseId === "string" && qmCourse.coreCourseId.trim()
        ? qmCourse.coreCourseId.trim()
        : undefined;

    // Call EduAI service to generate questions
    const mcqN =
      mcqRequiredChoiceCount != null && Number.isFinite(Number(mcqRequiredChoiceCount))
        ? Math.min(26, Math.max(2, Math.floor(Number(mcqRequiredChoiceCount))))
        : undefined;

    const questions = await eduaiService.generateQuestions({
      prompt: budget.prompt,
      courseCode: resolvedCourseCode,
      courseId: coreCourseId,
      model: model || "google:gemini-2.5-flash",
      apiKeys: apiKeys || {},
      numQuestions: budget.numQuestions,
      difficultyDistribution: difficultyDistribution || { easy: 1, medium: 2, hard: 2 },
      reasoningDistribution: reasoningDistribution || {
        factual: 40,
        analytical: 30,
        application: 30,
      },
      ...(mcqN != null ? { mcqRequiredChoiceCount: mcqN } : {}),
      cookie: req.headers.cookie ?? '',
      signal: req.aiOperation?.signal,
      deadlineAt: req.aiOperation?.deadlineAt,
    });

    res.json({
      success: true,
      data: {
        questions,
        count: questions.length,
        course: {
          id: qmCourse.id,
          name: qmCourse.name,
          code: resolvedCourseCode,
          coreCourseId: coreCourseId ?? null,
        },
      },
    });
  } catch (error) {
    logEduaiRouteError('EduAI question generation error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate questions',
      code: 'EDUAI_GENERATION_FAILED',
    });
  }
});

/** GET /api/eduai/courses – fetches the list of EduAI-managed courses for selection. */
router.get("/courses", async (req, res) => {
  try {
    // Never expose the service-key catalog directly. The QM list applies the
    // caller's live Core/QM access policy (including ADMIN/unit rules).
    const visibleCourses = await listCoursesForUser(req.user, {
      cookie: req.headers.cookie ?? '',
    });
    const coursesData = visibleCourses.map(projectVisibleCourse).filter(Boolean);

    res.json({
      success: true,
      data: coursesData,
    });
  } catch (error) {
    logEduaiRouteError('EduAI list courses error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve courses from EduAI',
      code: 'EDUAI_COURSE_LIST_FAILED',
    });
  }
});

/** GET /api/eduai/courses/:courseId/topics – retrieves EduAI topics for the given course ID. */
router.get("/courses/:courseId/topics", async (req, res) => {
  try {
    const { courseId } = req.params;
    const normalizedCourseId = typeof courseId === 'string' ? courseId.trim() : '';

    if (!normalizedCourseId) {
      return res.status(400).json({ error: 'Course ID is required' });
    }

    // A Core id is not itself an authorization token. Resolve it through a
    // local QM anchor and the caller's live enrollment/unit access before the
    // service-key topic fetch; deny indistinguishably to prevent ID probing.
    const resolved = await resolveCoreCourseAccess(
      req.user,
      normalizedCourseId,
      req.headers.cookie ?? '',
    );
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
        code: 'COURSE_NOT_FOUND',
      });
    }

    const topics = await eduaiService.getCourseTopics(normalizedCourseId);

    res.json({
      success: true,
      data: topics,
    });
  } catch (error) {
    logEduaiRouteError('EduAI course topics error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve topics from EduAI',
      code: 'EDUAI_COURSE_TOPICS_FAILED',
    });
  }
});

/**
 * POST /api/eduai/test-api-key – validates AI connectivity. Accepts an optional
 * `apiKeys` body carrying the caller's browser-stored provider keys (e.g. Google)
 * so the check validates the cloud provider rather than the (possibly offline)
 * UBC-hosted provider. An optional `provider` pins the probe to a specific path
 * (e.g. `'ollama'` for the independent UBC status chip). Echoes back `provider`
 * so the UI can report which path is live.
 */
router.post('/test-api-key', qmAiUserRateLimit, testApiKeyAdmission, async (req, res) => {
  try {
    const result = await eduaiService.testApiKey({
      cookie: req.headers.cookie ?? "",
      apiKeys: req.body?.apiKeys ?? {},
      forceProvider: req.aiAdmission.provider || undefined,
      signal: req.aiOperation?.signal,
      deadlineAt: req.aiOperation?.deadlineAt,
    });

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        provider: result.provider,
        data: result.response,
      });
    } else {
      const status = Number(result.statusCode) === 429 ? 429 : 400;
      res.status(status).json({
        success: false,
        provider: result.provider,
        error: status === 429 ? 'AI provider rate limit exceeded; try again later' : 'EduAI API key test failed',
        code: status === 429 ? 'EDUAI_UPSTREAM_RATE_LIMITED' : 'EDUAI_API_KEY_TEST_REJECTED',
        statusCode: Number.isInteger(result.statusCode) ? result.statusCode : undefined,
      });
    }
  } catch (error) {
    logEduaiRouteError('EduAI API key test error', error);
    if (Number(error?.statusCode ?? error?.status) === 429 || isQmAiDeadlineError(error) || Number(error?.statusCode ?? error?.status) === 504) {
      return sendStableAiFailure(res, error, 'EDUAI_API_KEY_TEST_FAILED', 'Failed to test EduAI API key');
    }
    res.status(500).json({ success: false, error: 'Failed to test EduAI API key', code: 'EDUAI_API_KEY_TEST_FAILED' });
  }
});

/**
 * Minimal cloud/local model catalog used when EduAI Core's model list is
 * unreachable. Lets the picker stay usable (especially the cloud Google model,
 * which only needs the caller's own API key) instead of rendering empty.
 */
const FALLBACK_AI_MODELS = [
  {
    provider: "google",
    modelId: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Cloud model — uses your own Google API key.",
    isActive: true,
  },
  {
    provider: 'opencode',
    modelId: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (OpenCode Go)',
    description: 'Requires your own OpenCode Go subscription and API key.',
    isActive: true,
  },
  {
    provider: 'vllm',
    modelId: 'qwen2.5-7b-instruct',
    name: 'Qwen2.5 7B Instruct (UBC hosted)',
    description: 'UBC-hosted vLLM. Requires UBC network/VPN. Fast connectivity probe.',
    isActive: true,
  },
  {
    provider: "vllm",
    modelId: "qwen2.5-32b-instruct",
    name: "Qwen2.5 32B Instruct (UBC hosted)",
    description: "UBC-hosted vLLM. Requires UBC network/VPN. Preferred for extraction.",
    isActive: true,
  },
];

/** GET /api/eduai/ai-models – returns the available AI model identifiers from EduAI. */
router.get("/ai-models", async (req, res) => {
  try {
    const models = await eduaiService.listAIModels({ cookie: req.headers.cookie ?? "" });
    if (Array.isArray(models) && models.length > 0) {
      return res.json(models);
    }
    // Core catalog empty/unreachable — fall back to a minimal list so the picker
    // stays usable (the cloud model works with the caller's own provider key).
    console.warn(
      "EduAI model list empty — serving fallback catalog. Check Core session or EDUAI_API_KEY",
    );
    return res.json(FALLBACK_AI_MODELS);
  } catch (error) {
    logEduaiRouteError('EduAI list models error', error);
    // Auth failures are the caller's problem to fix; surface them. For any other
    // failure, degrade gracefully to the fallback catalog rather than an empty picker.
    const status = error.status ?? error.statusCode;
    if (status === 401 || status === 403) {
      return res.status(status).json({
        success: false,
        error: 'Failed to retrieve AI models from EduAI',
        code: 'EDUAI_MODELS_ACCESS_DENIED',
      });
    }
    return res.json(FALLBACK_AI_MODELS);
  }
});

export default router;
