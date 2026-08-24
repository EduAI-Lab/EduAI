/**
 * Router for question (question_metadata) management: CRUD, statistics, AI
 * generation, and extraction workflows.
 *
 * RBAC (rbac-matrix.md §16, issues #311/#312):
 *  - Course-specific routes add a per-course access gate (requireCourseAccess /
 *    requireQuestionAccess) and scope the service by the authorized course's
 *    owner id (`req.qmCourse.userId`); `createdBy` records the actual author.
 *    This is the source of truth for course-level TA access: Core sessions carry
 *    a platform STUDENT role for TAs, while the active enrollment resolves to
 *    `courseAccess.level === 'ta'`. Course-less list/aggregate routes retain the
 *    platform authoring-role gate so this does not become blanket STUDENT access.
 *  - #312: TA may edit/delete only question_metadata they created.
 *  - List/aggregate routes (list, stats, generate) carry the flat gate only and
 *    remain caller-scoped; AI generation additionally requires a course context
 *    and uses a caller-keyed resource limiter.
 *  - POST /approve is the exception: no flat role gate — a course TA (platform
 *    STUDENT + TA enrollment) may create question_metadata shells, so the
 *    per-course gate alone authorizes that route (see its inline comment).
 */
import express from "express";
import {
  createQuestion,
  getQuestionsByUser,
  enrichQuestionRows,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  createMultipleQuestions,
  getQuestionStats,
  updateQuestionOrder,
  removeQuestionFromAssessment,
  saveExtractedQuestions,
  normalizePrimaryTopicId,
} from "../services/questionService.js";
import {
  generateQuestions,
  AI_PROVIDERS,
  extractQuestionsFromText,
} from "../services/aiService.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { QM_AUTHORIZED } from "../middleware/roles.js";
import {
  requireCourseAccess,
  resolveCourseAccessWithCourse,
  LEVELS,
} from "../middleware/courseAccess.js";
import { requireQuestionAccess } from "../middleware/resourceAccess.js";
import { prisma } from "../config/database.js";
import { config } from "../config/settings.js";
import { parseLimitOffset } from "../utils/listPagination.js";
import { parseQuestionListFilters } from "../utils/questionListQuery.js";
import { parseApprovalTarget, prepareApprovalQuestions } from "../utils/questionApproval.js";
import { resolveVisibleCourseWhereForUser } from "../services/courseListService.js";
import { parsePositiveSafeInteger } from "../utils/questionOrder.js";
import { qmAiUserRateLimit, validateGenerationBudget } from "../middleware/aiAdmission.js";

const router = express.Router();

const qmMaxExtractTextChars = () =>
  Number.isInteger(config.qmMaxExtractTextChars) && config.qmMaxExtractTextChars > 0
    ? config.qmMaxExtractTextChars
    : 120_000;

/** Reject a TA editing/deleting a question they did not create (§19, #312). */
function denyTaNotOwner(req, res) {
  if (req.courseAccess?.level === "ta" && req.question?.createdBy !== req.user.id) {
    res.status(403).json({ success: false, error: "TAs can only modify their own questions" });
    return true;
  }
  return false;
}

/** Validate and normalize the single target course for an approval batch. */
function validateApprovalTarget(req, res, next) {
  const { error, questions, targetCourseId } = parseApprovalTarget(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error,
    });
  }

  const maxQuestions =
    Number.isInteger(config.maxQuestions) && config.maxQuestions > 0 ? config.maxQuestions : 50;
  if (questions.length > maxQuestions) {
    return res.status(400).json({
      success: false,
      error: `Cannot approve more than ${maxQuestions} questions at once`,
    });
  }

  req.approvalCourseId = targetCourseId;
  next();
}

/**
 * Resolve an assessment only if it belongs to the given course. The order routes mutate
 * per-assessment composition, so a client-supplied assessmentId must not point at an
 * assessment in a different course (even one owned by the same user). Returns null when
 * the id is non-integer, missing, or cross-course.
 */
async function assessmentInCourse(assessmentId, courseId) {
  const id = parsePositiveSafeInteger(assessmentId);
  if (id === null) return null;
  const assessment = await prisma.assessments.findUnique({ where: { id } });
  return assessment && assessment.courseId === courseId ? assessment : null;
}

/** POST /api/questions – validates payload and creates a new question for the course. */
router.post(
  "/",
  authenticateToken,
  requireCourseAccess({ min: "ta", getCourseId: (req) => req.body.courseId ?? req.body.classId }),
  async (req, res, next) => {
    try {
      const rawDescription = req.body.description ?? req.body.content;
      const rawPrimaryTopicId = req.body.primaryTopicId;
      const type = req.body.type || "MCQ";
      const questionOrder = req.body.questionOrder;
      const isAiGenerated = req.body.isAiGenerated;
      const isDraft = req.body.isDraft;

      const allowedTypes = ["MCQ", "SA", "LA"];
      if (type && !allowedTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid question type. Allowed values: ${allowedTypes.join(", ")}`,
        });
      }

      const description =
        typeof rawDescription === "string" && rawDescription.trim() ? rawDescription.trim() : null;

      const primaryTopicId = normalizePrimaryTopicId(rawPrimaryTopicId);
      if (!primaryTopicId) {
        return res.status(400).json({
          success: false,
          error: "Valid primaryTopicId is required",
        });
      }

      const question = await createQuestion(req.qmCourse.userId, {
        description,
        courseId: req.qmCourse.id,
        primaryTopicId,
        type,
        questionOrder,
        isAiGenerated,
        isDraft,
        createdBy: req.user.id,
      });

      res.status(201).json({
        success: true,
        message: "Question created successfully",
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/questions – lists the question bank.
 *
 * When a courseId is supplied (the UI's course-bank view), any caller with
 * view access to that course — including an enrolled TA who doesn't own it —
 * sees the whole bank: we verify course access (§16 view, min 'ta') and scope
 * by the course owner. Without a courseId the shared course-list visibility
 * predicate includes every course the caller can author in (ADMIN catalog,
 * UNIT_ADMIN units, and instructor enrollments), including non-owned anchors.
 */
router.get("/", authenticateToken, async (req, res, next) => {
  try {
    const { courseId, classId } = req.query;
    const requestedCourseId = courseId ?? classId;
    const normalizedCourseId =
      requestedCourseId === undefined || requestedCourseId === "" ? undefined : requestedCourseId;

    let scopeUserId = req.user.id;
    let scopeCourseId = normalizedCourseId;
    let courseWhere;

    if (normalizedCourseId !== undefined) {
      const { course, access } = await resolveCourseAccessWithCourse(req.user, normalizedCourseId, {
        cookie: req.headers.cookie,
      });
      if (!course) {
        return res.status(404).json({ success: false, error: "Course not found" });
      }
      if (!access || access.rank < LEVELS.ta.rank) {
        return res.status(403).json({ success: false, error: "Insufficient course access" });
      }
      // Owner-scope so an enrolled non-owner viewer still sees the course bank.
      scopeUserId = course.userId;
      scopeCourseId = course.id;
    } else {
      // The course-bank view is TA-capable only when a concrete course is
      // supplied and resolved above. Keep the legacy caller-scoped aggregate
      // path restricted to platform authoring roles; otherwise a STUDENT
      // session would gain an unscoped list merely by clearing `courseId`.
      if (!QM_AUTHORIZED.includes(req.user.role)) {
        return res
          .status(403)
          .json({ success: false, error: "Question bank courseId is required" });
      }
      courseWhere = await resolveVisibleCourseWhereForUser(req.user, {
        cookie: req.headers.cookie,
      });
    }

    const { limit, offset } = parseLimitOffset(req.query);
    const listFilters = parseQuestionListFilters(req.query);
    const page = await getQuestionsByUser(scopeUserId, {
      courseId: scopeCourseId,
      questionBankId: req.query.questionBankId,
      courseWhere,
      ...listFilters,
      limit,
      offset,
    });

    res.json({
      success: true,
      data: page,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions/stats – returns aggregate stats (counts, types) for the user’s question bank. */
router.get("/stats", authenticateToken, async (req, res, next) => {
  try {
    const { courseId, classId } = req.query;
    const requestedCourseId = courseId ?? classId;
    let scopeUserId = req.user.id;
    let scopeCourseId;
    let courseWhere;

    if (requestedCourseId !== undefined && requestedCourseId !== "") {
      const { course, access } = await resolveCourseAccessWithCourse(req.user, requestedCourseId, {
        cookie: req.headers.cookie,
      });
      if (!course) {
        return res.status(404).json({ success: false, error: "Course not found" });
      }
      if (!access || access.rank < LEVELS.ta.rank) {
        return res.status(403).json({ success: false, error: "Insufficient course access" });
      }
      scopeUserId = course.userId;
      scopeCourseId = course.id;
    } else {
      if (!QM_AUTHORIZED.includes(req.user.role)) {
        return res
          .status(403)
          .json({ success: false, error: "Question bank courseId is required" });
      }
      courseWhere = await resolveVisibleCourseWhereForUser(req.user, {
        cookie: req.headers.cookie,
      });
    }

    const stats = await getQuestionStats(scopeUserId, {
      courseId: scopeCourseId,
      courseWhere,
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/** Escape a value for a CSV cell (RFC 4180: quote and double embedded quotes). */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/questions/export?courseId=<id>&format=csv|json – bulk-exports a
 * course's questions with their variants. Course-access gated (TA access or
 * above). Reuses getQuestionsByUser (eager-loads course + variants, so no N+1).
 * Registered before `/:id` so the static `export` segment isn't captured as an id.
 */
router.get("/export", authenticateToken, async (req, res, next) => {
  try {
    const { courseId, classId, format = "json" } = req.query;
    const requestedCourseId = courseId ?? classId;

    if (requestedCourseId === undefined || requestedCourseId === "") {
      return res.status(400).json({ success: false, error: "courseId is required for export" });
    }

    const normalizedFormat = String(format).toLowerCase();
    if (normalizedFormat !== "csv" && normalizedFormat !== "json") {
      return res.status(400).json({ success: false, error: "format must be 'csv' or 'json'" });
    }

    const { course, access } = await resolveCourseAccessWithCourse(req.user, requestedCourseId, {
      cookie: req.headers.cookie,
    });
    if (!course) {
      return res.status(404).json({ success: false, error: "Course not found" });
    }
    if (!access || access.rank < LEVELS.ta.rank) {
      return res.status(403).json({ success: false, error: "Insufficient course access" });
    }

    // Owner-scope so an enrolled non-owner viewer still exports the full bank.
    // Batch the scan (#1044) instead of a single hard-coded limit:100000 read —
    // page through in fixed chunks and stop on the first short page, so a large
    // bank never materializes as one unbounded query.
    // `enrich: false` keeps the per-batch work purely local — enrichment does an
    // uncached fetch of Core's whole course catalog, so leaving it on would turn
    // one Core roundtrip into one per batch and blow the request's time budget
    // on a large bank. Enrich once over the assembled set instead.
    // Each batch is the #1040 `{ items, total, limit, offset }` envelope.
    const EXPORT_BATCH_SIZE = 500;
    const rawQuestions = [];
    for (let offset = 0; ; offset += EXPORT_BATCH_SIZE) {
      const batch = await getQuestionsByUser(course.userId, {
        courseId: course.id,
        limit: EXPORT_BATCH_SIZE,
        offset,
        enrich: false,
      });
      rawQuestions.push(...batch.items);
      if (batch.items.length < EXPORT_BATCH_SIZE) break;
    }
    const questions = await enrichQuestionRows(rawQuestions);

    if (normalizedFormat === "json") {
      return res.json({ success: true, data: questions });
    }

    // CSV: one row per variant, with question context repeated. Questions with no
    // variants still emit a row so the export isn't silently lossy.
    const header = [
      "questionId",
      "questionType",
      "questionDescription",
      "primaryTopicId",
      "variantId",
      "questionText",
      "difficulty",
      "reasoningLevel",
      "answer",
      "choices",
      "isDraft",
      "isAiGenerated",
    ];
    const lines = [header.map(csvCell).join(",")];

    for (const q of questions) {
      const variants = q.variants ?? [];
      if (variants.length === 0) {
        lines.push(
          [q.id, q.type, q.description, q.primaryTopicId, "", "", "", "", "", "", "", ""]
            .map(csvCell)
            .join(","),
        );
        continue;
      }
      for (const v of variants) {
        lines.push(
          [
            q.id,
            q.type,
            q.description,
            q.primaryTopicId,
            v.id,
            v.questionText,
            v.difficulty,
            v.reasoningLevel,
            v.answer,
            v.choices != null ? JSON.stringify(v.choices) : "",
            v.isDraft,
            v.isAiGenerated,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }

    const csv = lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="questions-course-${course.id}.csv"`,
    );
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions/:id – fetches a single question after verifying course access. */
router.get(
  "/:id",
  authenticateToken,
  requireQuestionAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      const question = await getQuestionById(req.params.id, req.qmCourse.userId);

      res.json({
        success: true,
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** PUT /api/questions/:id – updates question metadata/type/order flags, enforcing validation rules. */
router.put(
  "/:id",
  authenticateToken,
  requireQuestionAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      if (denyTaNotOwner(req, res)) return;

      const {
        description,
        content,
        courseId,
        classId,
        type,
        primaryTopicId,
        questionOrder,
        isAiGenerated,
        isDraft,
      } = req.body; //mock for AI generated questions

      const updates = {};

      if (description !== undefined || content !== undefined) {
        const value = (description ?? content ?? "").trim();
        updates.description = value || null;
      }

      if (courseId !== undefined || classId !== undefined) {
        const resolvedCourseId = Number(courseId ?? classId);
        if (!Number.isInteger(resolvedCourseId)) {
          return res.status(400).json({
            success: false,
            error: "Valid courseId is required",
          });
        }
        // Question course ownership is immutable. Reject relocation here so
        // same-course updates resolve Core access only once; the service keeps
        // the same invariant for direct callers that bypass this route.
        if (resolvedCourseId !== Number(req.qmCourse.id)) {
          return res.status(409).json({
            success: false,
            error: "Question course relocation is not supported",
            code: "COURSE_RELOCATION_NOT_ALLOWED",
          });
        }
        updates.courseId = resolvedCourseId;
      }

      if (primaryTopicId !== undefined) {
        const resolvedTopicId = normalizePrimaryTopicId(primaryTopicId);
        if (!resolvedTopicId) {
          return res.status(400).json({
            success: false,
            error: "Valid primaryTopicId is required",
          });
        }
        updates.primaryTopicId = resolvedTopicId;
      }

      if (type !== undefined) {
        const allowedTypes = ["MCQ", "SA", "LA"];
        if (!allowedTypes.includes(type)) {
          return res.status(400).json({
            success: false,
            error: `Invalid question type. Allowed values: ${allowedTypes.join(", ")}`,
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
          error: "No valid fields provided to update",
        });
      }

      const question = await updateQuestion(req.params.id, req.qmCourse.userId, updates);

      res.json({
        success: true,
        message: "Question updated successfully",
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/questions/:id – removes a question; TAs may delete only their own. */
router.delete(
  "/:id",
  authenticateToken,
  requireQuestionAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      if (denyTaNotOwner(req, res)) return;

      await deleteQuestion(req.params.id, req.qmCourse.userId);

      res.json({
        success: true,
        message: "Question deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/questions/generate – triggers legacy AI providers to generate draft questions. */
router.post(
  "/generate",
  authenticateToken,
  // Legacy generation used to be course-free. Keep it available only when
  // the caller supplies a course they can author in; otherwise deployment API
  // keys could be used as an unscoped generation oracle.
  requireCourseAccess({ min: "ta", getCourseId: (req) => req.body.courseId }),
  qmAiUserRateLimit,
  async (req, res, next) => {
    try {
      const {
        prompt,
        provider = AI_PROVIDERS.GROQ,
        numQuestions = 15,
        difficultyDistribution,
      } = req.body;

      const budget = validateGenerationBudget({ prompt, numQuestions });
      if (budget.status) {
        return res.status(budget.status).json({
          success: false,
          error: budget.message,
          code: budget.code,
        });
      }

      const params = {
        numQuestions: budget.numQuestions,
        difficultyDistribution: difficultyDistribution || {
          easy: 5,
          medium: 5,
          hard: 5,
        },
      };

      const questions = await generateQuestions(budget.prompt, provider, params);

      res.json({
        success: true,
        message: "Questions generated successfully",
        data: questions,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/questions/extract – sends OCR text to the AI extraction service and returns proposed questions. */
router.post(
  "/extract",
  authenticateToken,
  requireCourseAccess({ min: "ta", getCourseId: (req) => req.body.courseId }),
  qmAiUserRateLimit,
  async (req, res, next) => {
    try {
      const { text, model, apiKeys } = req.body;

      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: "Text content is required for extraction",
        });
      }

      const maxTextChars = qmMaxExtractTextChars();
      if (text.length > maxTextChars) {
        return res.status(413).json({
          success: false,
          error: `OCR text cannot exceed ${maxTextChars.toLocaleString()} characters`,
        });
      }

      const questions = await extractQuestionsFromText(text, req.qmCourse.id, model, apiKeys, {
        cookie: req.headers.cookie ?? "",
      });

      res.json({
        success: true,
        data: questions,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/questions/extract/save – persists selected extracted questions (optionally tying them to an assessment). */
router.post(
  "/extract/save",
  authenticateToken,
  requireCourseAccess({ min: "ta", getCourseId: (req) => req.body.courseId }),
  async (req, res, next) => {
    try {
      const { primaryTopicId, topicName, questions, assessment } = req.body;

      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one question is required",
        });
      }

      if (questions.length > config.maxQuestions) {
        return res.status(400).json({
          success: false,
          error: `Cannot save more than ${config.maxQuestions} questions at once`,
        });
      }

      const result = await saveExtractedQuestions(req.qmCourse.userId, {
        courseId: req.qmCourse.id,
        primaryTopicId: normalizePrimaryTopicId(primaryTopicId) ?? undefined,
        topicName,
        questions,
        assessment,
        createdBy: req.user.id,
        cookie: req.headers.cookie,
      });
      const saved = result.questions;

      res.status(201).json({
        success: true,
        message: `${saved.length} question${saved.length === 1 ? "" : "s"} saved successfully`,
        data: saved,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/questions/approve – bulk saves approved questions into one authorized course.
 *
 * Unlike the other authoring routes, this endpoint has no flat platform-role gate:
 * a course TA (platform STUDENT + TA enrollment) is authorized to create
 * question_metadata shells (§16, issue #1106), and `requireCourseAccess({ min: 'ta' })`
 * is the sole authorization gate — it admits ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) /
 * TA(C) while rejecting everyone else with insufficient course access.
 */
router.post(
  "/approve",
  authenticateToken,
  validateApprovalTarget,
  requireCourseAccess({ min: "ta", getCourseId: (req) => req.approvalCourseId }),
  async (req, res, next) => {
    try {
      const { questions } = req.body;
      const targetCourseId = req.qmCourse.id;
      const prepared = prepareApprovalQuestions(questions, {
        targetCourseId,
        createdBy: req.user.id,
        normalizeTopicId: normalizePrimaryTopicId,
      });
      if (prepared.error) {
        return res.status(400).json({
          success: false,
          error: prepared.error,
        });
      }

      const savedQuestions = await createMultipleQuestions(req.qmCourse.userId, prepared.questions);

      res.status(201).json({
        success: true,
        message: `${savedQuestions.length} questions saved successfully`,
        data: savedQuestions,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** PUT /api/questions/:id/order – updates an assessment-specific order value for the question (instructor-only, §17). */
router.put(
  "/:id/order",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireQuestionAccess({ min: "instructor" }),
  async (req, res, next) => {
    try {
      const { assessmentId, orderNumber } = req.body;

      if (!assessmentId || orderNumber === undefined) {
        return res.status(400).json({
          success: false,
          error: "Assessment ID and order number are required",
        });
      }

      const normalizedAssessmentId = parsePositiveSafeInteger(assessmentId);
      if (normalizedAssessmentId === null) {
        return res.status(404).json({ success: false, error: "Assessment not found" });
      }
      const normalizedOrderNumber = parsePositiveSafeInteger(orderNumber);
      if (normalizedOrderNumber === null) {
        return res.status(400).json({
          success: false,
          error: "Order number must be a positive safe integer",
        });
      }

      if (!(await assessmentInCourse(normalizedAssessmentId, req.qmCourse.id))) {
        return res.status(404).json({ success: false, error: "Assessment not found" });
      }

      const question = await updateQuestionOrder(
        req.params.id,
        normalizedAssessmentId,
        normalizedOrderNumber,
        req.qmCourse.userId,
      );

      res.json({
        success: true,
        message: "Question order updated successfully",
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/questions/:id/order/:assessmentId – removes a question from an assessment’s ordering (instructor-only, §17). */
router.delete(
  "/:id/order/:assessmentId",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireQuestionAccess({ min: "instructor" }),
  async (req, res, next) => {
    try {
      if (!(await assessmentInCourse(req.params.assessmentId, req.qmCourse.id))) {
        return res.status(404).json({ success: false, error: "Assessment not found" });
      }

      const question = await removeQuestionFromAssessment(
        req.params.id,
        req.params.assessmentId,
        req.qmCourse.userId,
      );

      res.json({
        success: true,
        message: "Question removed from assessment order",
        data: question,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
