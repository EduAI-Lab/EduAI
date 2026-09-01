/**
 * Router for EduAI proxy endpoints, enabling chat, question generation, and metadata retrieval.
 * All routes require authentication and delegate to eduaiService for actual API interactions.
 */
import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { QM_AUTHORIZED } from "../middleware/roles.js";
import eduaiService from "../services/eduaiService.js";
import {
  resolveAccessForCourse,
  resolveCourseAccessWithCourse,
  LEVELS,
} from "../middleware/courseAccess.js";
import { findCoursesByProjectedCode, listCoursesForUser } from "../services/courseListService.js";
import { listCoursesFromCore } from "../services/coreApiService.js";
import { prisma } from "../config/database.js";
import { safeRequestLogFields } from "../utils/safeLogging.js";
import {
  qmAiUserRateLimit,
  qmAiProviderCallAdmission,
  validateChatAdmission,
  validateTestApiKeyAdmission,
  validateGenerationBudget,
  isQmAiDeadlineError,
  assertQmAiDeadline,
} from "../middleware/aiAdmission.js";
import {
  deleteUserProviderSettingOnCore,
  getUserProviderSettingsFromCore,
  upsertUserProviderSettingOnCore,
} from "../services/coreApiService.js";

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
  if (typeof coreCourseId !== "string" || !coreCourseId.trim()) return null;
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

/**
 * Prefer QM `courseId` + `resolveCourseAccessWithCourse` (same gate as the rest
 * of QM). Fall back to `courseCode` lookup when only a code is supplied (#1362).
 *
 * @returns {{ course: object, access: object } | { error: { status: number, body: object } }}
 */
async function resolveEduAiCourse(req, signal) {
  const { courseId, courseCode } = req.body ?? {};
  const hasCourseId = courseId !== null && courseId !== undefined && String(courseId).trim() !== "";
  const hasCourseCode = typeof courseCode === "string" && courseCode.trim() !== "";

  if (hasCourseId) {
    const { course, access } = await resolveCourseAccessWithCourse(
      req.user,
      String(courseId).trim(),
      {
        cookie: req.headers.cookie,
        signal,
      },
    );
    assertQmAiDeadline({ signal });
    if (!course) {
      return { error: { status: 404, body: { success: false, error: "Course not found" } } };
    }
    if (!access || access.rank < LEVELS.ta.rank) {
      return {
        error: { status: 403, body: { success: false, error: "Insufficient course access" } },
      };
    }
    return { course, access };
  }

  if (hasCourseCode) {
    const resolved = await resolveCourseCodeAccess(
      req.user,
      courseCode,
      req.headers.cookie,
      signal,
    );
    if (!resolved) {
      return {
        error: {
          status: 403,
          body: {
            success: false,
            error: "You do not have access to this course",
            code: "COURSE_ACCESS_DENIED",
          },
        },
      };
    }
    return resolved;
  }

  return {
    error: { status: 400, body: { error: "Course id or course code is required" } },
  };
}

function resolvedCourseFields(qmCourse, fallbackCourseCode) {
  const resolvedCourseCode =
    (qmCourse.code && String(qmCourse.code).trim()) || fallbackCourseCode || "";
  const coreCourseId =
    typeof qmCourse.coreCourseId === "string" && qmCourse.coreCourseId.trim()
      ? qmCourse.coreCourseId.trim()
      : undefined;
  return { resolvedCourseCode, coreCourseId };
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

// Core represents a course TA as platform STUDENT. Every course-bearing route
// below resolves the caller's live enrollment at TA rank before reaching AI.
router.use(authenticateToken);

// Course-bearing routes below resolve live enrollment access themselves so a
// platform STUDENT with a TA enrollment can use them. These two endpoints are
// intentionally unscoped: the provider probe can spend shared AI capacity and
// the model catalog is an admin-only Core surface. Let a live TA use the same
// picker/status UX, while ordinary STUDENTs remain denied.
const requireQmAuthoringOrLiveTa = async (req, res, next) => {
  if (QM_AUTHORIZED.includes(req.user?.role)) return next();
  if (req.user?.role !== "STUDENT") {
    return res.status(403).json({
      success: false,
      error: "Question Maker authoring access required",
    });
  }

  try {
    const coreCourses = await listCoursesFromCore(req.headers.cookie ?? "", { all: true });
    if (coreCourses.some((course) => course?.callerEnrollmentRole === "TA")) return next();
  } catch {
    // Fail closed when the live Core course snapshot is unavailable.
  }

  return res.status(403).json({
    success: false,
    error: "Question Maker authoring access required",
  });
};

router.get("/provider-settings", async (req, res, next) => {
  try {
    res.json(await getUserProviderSettingsFromCore(req.headers.cookie ?? ""));
  } catch (error) {
    next(error);
  }
});

router.post("/provider-settings", async (req, res, next) => {
  const { providerName, isEnabled, apiKey, baseUrl } = req.body ?? {};
  if (typeof providerName !== "string" || !providerName.trim()) {
    return res.status(400).json({ error: "providerName is required" });
  }
  if (typeof isEnabled !== "boolean") {
    return res.status(400).json({ error: "isEnabled must be a boolean" });
  }
  if (apiKey !== undefined && typeof apiKey !== "string") {
    return res.status(400).json({ error: "apiKey must be a string" });
  }
  if (baseUrl !== undefined && typeof baseUrl !== "string") {
    return res.status(400).json({ error: "baseUrl must be a string" });
  }
  try {
    const payload = { providerName: providerName.trim(), isEnabled };
    if (apiKey !== undefined) payload.apiKey = apiKey;
    if (baseUrl !== undefined) payload.baseUrl = baseUrl;
    await upsertUserProviderSettingOnCore(req.headers.cookie ?? "", payload);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.delete("/provider-settings", async (req, res, next) => {
  const providerName =
    typeof req.query.providerName === "string" ? req.query.providerName.trim() : "";
  if (!providerName) return res.status(400).json({ error: "providerName is required" });
  try {
    await deleteUserProviderSettingOnCore(req.headers.cookie ?? "", providerName);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

const chatAdmission = qmAiProviderCallAdmission({
  validate: validateChatAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

const testApiKeyAdmission = qmAiProviderCallAdmission({
  validate: validateTestApiKeyAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

const generationAdmission = qmAiProviderCallAdmission({
  validate: (body) => {
    const budget = validateGenerationBudget({
      prompt: body?.prompt,
      numQuestions: body?.numQuestions,
    });
    if (budget.status) {
      // Prompt errors win over missing identifier (#1362 validation order)
      if (budget.code === "QM_PROMPT_REQUIRED" || budget.code === "QM_PROMPT_TOO_LARGE") {
        return budget;
      }
      const hasCourseId = body?.courseId != null && String(body.courseId).trim() !== "";
      const hasCourseCode = typeof body?.courseCode === "string" && body.courseCode.trim() !== "";
      if (!hasCourseId && !hasCourseCode) {
        return {
          status: 400,
          code: "QM_COURSE_REQUIRED",
          message: "Course id or course code is required",
        };
      }
      return budget;
    }

    const hasCourseId = body?.courseId != null && String(body.courseId).trim() !== "";
    const hasCourseCode = typeof body?.courseCode === "string" && body.courseCode.trim() !== "";
    if (!hasCourseId && !hasCourseCode) {
      return {
        status: 400,
        code: "QM_COURSE_REQUIRED",
        message: "Course id or course code is required",
      };
    }

    // generateQuestions makes one provider call and may make one bounded
    // JSON-repair call, so reserve the complete worst-case fanout up front.
    return { ...budget, providerCalls: 2 };
  },
  getCost: (req) => req.aiAdmission.providerCalls,
});

function sendStableAiFailure(res, error, fallbackCode, fallbackMessage) {
  const statusCode = Number(error?.statusCode ?? error?.status);
  if (statusCode === 429) {
    return res.status(429).json({
      success: false,
      error: "AI provider rate limit exceeded; try again later",
      code: "EDUAI_UPSTREAM_RATE_LIMITED",
    });
  }
  if (isQmAiDeadlineError(error) || statusCode === 504) {
    return res.status(504).json({
      success: false,
      error: "AI operation timed out; try again later",
      code: "QM_AI_OPERATION_DEADLINE",
    });
  }
  return res.status(500).json({ success: false, error: fallbackMessage, code: fallbackCode });
}

/** POST /api/eduai/chat – proxies streaming chat prompts to EduAI with the given course. */
router.post("/chat", qmAiUserRateLimit, chatAdmission, async (req, res) => {
  try {
    const { model, apiKeys, streaming } = req.body;
    const { messages } = req.aiAdmission;
    const fallbackCourseCode =
      typeof req.body.courseCode === "string" ? req.body.courseCode.trim() : "";

    const resolved = await resolveEduAiCourse(req, req.aiOperation?.signal);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { course: qmCourse } = resolved;
    const { resolvedCourseCode, coreCourseId } = resolvedCourseFields(qmCourse, fallbackCourseCode);

    // Call EduAI service — prefer Core courseId when the QM course is linked.
    const response = await eduaiService.chat({
      messages,
      model: model || "google:gemini-2.5-flash",
      apiKeys: apiKeys || {},
      courseId: coreCourseId,
      courseCode: resolvedCourseCode,
      streaming: streaming || false,
      cookie: req.headers.cookie ?? "",
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
    logEduaiRouteError("EduAI chat error", error);
    if (
      Number(error?.statusCode ?? error?.status) === 429 ||
      isQmAiDeadlineError(error) ||
      Number(error?.statusCode ?? error?.status) === 504
    ) {
      return sendStableAiFailure(res, error, "EDUAI_CHAT_FAILED", "Failed to process chat request");
    }
    res
      .status(500)
      .json({ success: false, error: "Failed to process chat request", code: "EDUAI_CHAT_FAILED" });
  }
});

/** POST /api/eduai/generate-questions – requests generated questions from EduAI using the provided prompt and options. */
router.post("/generate-questions", qmAiUserRateLimit, generationAdmission, async (req, res) => {
  try {
    const {
      courseCode,
      model,
      apiKeys,
      difficultyDistribution,
      reasoningDistribution,
      mcqRequiredChoiceCount,
    } = req.body;

    // Admission already validated and normalized the finite generation
    // budget before reserving provider capacity or resolving the course.
    const budget = req.aiAdmission;
    const fallbackCourseCode = typeof courseCode === "string" ? courseCode.trim() : "";

    const resolved = await resolveEduAiCourse(req, req.aiOperation?.signal);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { course: qmCourse } = resolved;
    const { resolvedCourseCode, coreCourseId } = resolvedCourseFields(qmCourse, fallbackCourseCode);

    // Call EduAI service to generate questions
    const mcqN =
      mcqRequiredChoiceCount != null && Number.isFinite(Number(mcqRequiredChoiceCount))
        ? Math.min(26, Math.max(2, Math.floor(Number(mcqRequiredChoiceCount))))
        : undefined;

    const generateParams = {
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
      cookie: req.headers.cookie ?? "",
      signal: req.aiOperation?.signal,
      deadlineAt: req.aiOperation?.deadlineAt,
    };
    // An unusable choice count is left out entirely so the generator falls back
    // to its own default instead of seeing an explicit "no value".
    if (mcqN !== undefined) generateParams.mcqRequiredChoiceCount = mcqN;

    const questions = await eduaiService.generateQuestions(generateParams);

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
    logEduaiRouteError("EduAI question generation error", error);
    return sendStableAiFailure(
      res,
      error,
      "EDUAI_GENERATION_FAILED",
      "Failed to generate questions",
    );
  }
});

/** GET /api/eduai/courses – fetches the list of EduAI-managed courses for selection. */
router.get("/courses", async (req, res) => {
  try {
    // Never expose the service-key catalog directly. The QM list applies the
    // caller's live Core/QM access policy (including ADMIN/unit rules).
    const visibleCourses = await listCoursesForUser(req.user, {
      cookie: req.headers.cookie ?? "",
    });
    const coursesData = visibleCourses.map(projectVisibleCourse).filter(Boolean);

    res.json({
      success: true,
      data: coursesData,
    });
  } catch (error) {
    logEduaiRouteError("EduAI list courses error", error);
    // Honor an auth failure (missing cookie → 401) or an upstream Core status
    // instead of flattening everything to 500. Message/body stay redacted.
    // Core failures propagate as `coreError` with `.status` (see
    // coreApiService.coreError); the Axios/legacy shapes carry `.statusCode` /
    // `.response.status`. Only 401/403 are surfaced as client-facing auth
    // failures — everything else degrades to 500 so upstream 5xx never leaks.
    const rawStatus = error.status ?? error.statusCode ?? error.response?.status;
    const status = rawStatus === 401 || rawStatus === 403 ? rawStatus : 500;
    res.status(status).json({
      success: false,
      error:
        status === 401 || status === 403
          ? "Not authorized to list courses"
          : "Failed to retrieve courses from EduAI",
      code: "EDUAI_COURSE_LIST_FAILED",
    });
  }
});

/** GET /api/eduai/courses/:courseId/topics – retrieves EduAI topics for the given course ID. */
router.get("/courses/:courseId/topics", async (req, res) => {
  try {
    const { courseId } = req.params;
    const normalizedCourseId = typeof courseId === "string" ? courseId.trim() : "";

    if (!normalizedCourseId) {
      return res.status(400).json({ error: "Course ID is required" });
    }

    // A Core id is not itself an authorization token. Resolve it through a
    // local QM anchor and the caller's live enrollment/unit access before the
    // service-key topic fetch; deny indistinguishably to prevent ID probing.
    const resolved = await resolveCoreCourseAccess(
      req.user,
      normalizedCourseId,
      req.headers.cookie ?? "",
      req.aiOperation?.signal,
    );
    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const topics = await eduaiService.getCourseTopics(normalizedCourseId);

    res.json({
      success: true,
      data: topics,
    });
  } catch (error) {
    logEduaiRouteError("EduAI course topics error", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve topics from EduAI",
      code: "EDUAI_COURSE_TOPICS_FAILED",
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
router.post(
  "/test-api-key",
  requireQmAuthoringOrLiveTa,
  qmAiUserRateLimit,
  testApiKeyAdmission,
  async (req, res) => {
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
          error:
            status === 429
              ? "AI provider rate limit exceeded; try again later"
              : "EduAI API key test failed",
          code: status === 429 ? "EDUAI_UPSTREAM_RATE_LIMITED" : "EDUAI_API_KEY_TEST_REJECTED",
          statusCode: Number.isInteger(result.statusCode) ? result.statusCode : undefined,
        });
      }
    } catch (error) {
      logEduaiRouteError("EduAI API key test error", error);
      if (
        Number(error?.statusCode ?? error?.status) === 429 ||
        isQmAiDeadlineError(error) ||
        Number(error?.statusCode ?? error?.status) === 504
      ) {
        return sendStableAiFailure(
          res,
          error,
          "EDUAI_API_KEY_TEST_FAILED",
          "Failed to test EduAI API key",
        );
      }
      res.status(500).json({
        success: false,
        error: "Failed to test EduAI API key",
        code: "EDUAI_API_KEY_TEST_FAILED",
      });
    }
  },
);

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
    provider: "opencode",
    modelId: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash (OpenCode Go)",
    description: "Requires your own OpenCode Go subscription and API key.",
    isActive: true,
  },
  {
    provider: "vllm",
    modelId: "qwen3.5-2b-instruct",
    name: "Qwen3.5 2B Instruct (UBC hosted)",
    description: "UBC-hosted vLLM. Requires UBC network/VPN. Fast connectivity probe.",
    isActive: true,
  },
  {
    provider: "vllm",
    modelId: "qwen3.5-9b-instruct",
    name: "Qwen3.5 9B Instruct (UBC hosted)",
    description: "UBC-hosted vLLM. Requires UBC network/VPN. Preferred for extraction.",
    isActive: true,
  },
];

/** GET /api/eduai/ai-models – returns the available AI model identifiers from EduAI. */
router.get("/ai-models", requireQmAuthoringOrLiveTa, async (req, res) => {
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
    logEduaiRouteError("EduAI list models error", error);
    // Auth failures are the caller's problem to fix; surface them. For any other
    // failure, degrade gracefully to the fallback catalog rather than an empty picker.
    const status = error.status ?? error.statusCode;
    if (status === 401 || status === 403) {
      return res.status(status).json({
        success: false,
        error: "Failed to retrieve AI models from EduAI",
        code: "EDUAI_MODELS_ACCESS_DENIED",
      });
    }
    return res.json(FALLBACK_AI_MODELS);
  }
});

export default router;
