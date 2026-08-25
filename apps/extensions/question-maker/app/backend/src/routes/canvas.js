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
import express from "express";
import {
  exportAssessmentToCanvas,
  getCanvasCourseMapping,
  getCanvasQuizzes,
  getCanvasQuizQuestions,
  importQuizFromCanvas,
  getCanvasQuestionBanks,
  getCanvasQuestionBankQuestions,
  importQuestionBankFromCanvas,
  parseCanvasNumericId,
} from "../services/canvasService.js";
import {
  proxyCoreCanvasConnect,
  proxyCoreCanvasDisconnect,
  proxyCoreCanvasGetIntegration,
  proxyCoreCanvasListCourses,
} from "../services/coreApiService.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { CANVAS_ROLES } from "../middleware/roles.js";
import { requireCourseAccess } from "../middleware/courseAccess.js";
import { requireAssessmentAccess } from "../middleware/resourceAccess.js";
import { prisma } from "../config/database.js";

const router = express.Router();

function respondCoreError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 502;
  const payload = { success: false, error: err.message || "Core request failed" };
  // Core's machine-readable code and validation details are relayed only when
  // Core actually sent them.
  if (err.body?.error) payload.code = err.body.error;
  if (err.body?.details) payload.details = err.body.details;
  return res.status(status).json(payload);
}

function handleCoreProxyError(res, error, next) {
  if (Number.isInteger(error?.status)) {
    return respondCoreError(res, error);
  }
  return next(error);
}

/** Maps Core's picker items back to the Canvas API shape the QM frontend expects. */
function mapCoreCoursesForFrontend(coreData) {
  const courses = Array.isArray(coreData?.courses) ? coreData.courses : coreData;
  if (!Array.isArray(courses)) return [];

  return courses.map((course) => ({
    id: Number(course.canvasId ?? course.id),
    name: course.name,
    course_code: course.course_code ?? course.courseCode ?? course.name,
  }));
}

/** GET /api/canvas/integration – returns whether the caller has Canvas configured (own, no key exposed). */
router.get("/integration", authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const coreResult = await proxyCoreCanvasGetIntegration(req.headers.cookie);

    if (!coreResult?.data) {
      return res.json({
        success: true,
        data: null,
        message: coreResult?.message ?? "Canvas integration not configured",
      });
    }

    res.json({
      success: true,
      data: {
        canvasUrl: coreResult.data.canvasUrl,
        isTestMode: coreResult.data.isTestMode,
        isConnected: coreResult.data.isConnected ?? true,
      },
    });
  } catch (error) {
    handleCoreProxyError(res, error, next);
  }
});

/** POST /api/canvas/connect – stores the caller's Canvas credentials/test-mode flag on Core. */
router.post("/connect", authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const coreResult = await proxyCoreCanvasConnect(req.headers.cookie, req.body);

    const data = {
      canvasUrl: coreResult.data.canvasUrl,
      isTestMode: coreResult.data.isTestMode,
    };
    // Older Core builds omit `isConnected`; forward it only when Core states it.
    if (coreResult.data.isConnected !== undefined) {
      data.isConnected = coreResult.data.isConnected;
    }

    res.json({ success: true, message: coreResult.message, data });
  } catch (error) {
    handleCoreProxyError(res, error, next);
  }
});

/** DELETE /api/canvas/disconnect – removes the caller's saved Canvas integration on Core. */
router.delete(
  "/disconnect",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  async (req, res, next) => {
    try {
      const coreResult = await proxyCoreCanvasDisconnect(req.headers.cookie);

      res.json({
        success: true,
        message: coreResult?.message ?? "Canvas integration disconnected",
      });
    } catch (error) {
      handleCoreProxyError(res, error, next);
    }
  },
);

/** GET /api/canvas/courses – lists Canvas courses via the caller's Core integration. */
router.get("/courses", authenticateToken, requireRole(CANVAS_ROLES), async (req, res, next) => {
  try {
    const coreResult = await proxyCoreCanvasListCourses(req.headers.cookie);

    res.json({
      success: true,
      data: mapCoreCoursesForFrontend(coreResult.data),
    });
  } catch (error) {
    handleCoreProxyError(res, error, next);
  }
});

/** POST /api/canvas/export/:assessmentId – exports an assessment to Canvas (course-scoped, instructor-only). */
router.post(
  "/export/:assessmentId",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireAssessmentAccess({ min: "instructor", param: "assessmentId" }),
  async (req, res, next) => {
    try {
      const { assessmentId } = req.params;
      const { canvasCourseId, published } = req.body;

      if (!canvasCourseId) {
        return res.status(400).json({
          success: false,
          error: "Canvas course ID is required",
        });
      }

      const result = await exportAssessmentToCanvas(
        assessmentId,
        canvasCourseId,
        req.qmCourse.userId,
        req.headers.cookie,
        // Absent means publish: only an explicit `false` holds the quiz back.
        { published: published !== false },
      );

      res.json({
        success: true,
        message: "Assessment exported to Canvas successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/canvas/mapping/:courseId – returns the stored mapping (course-scoped, instructor-only). */
router.get(
  "/mapping/:courseId",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireCourseAccess({ min: "instructor", getCourseId: (req) => req.params.courseId }),
  async (req, res, next) => {
    try {
      const mapping = await getCanvasCourseMapping(
        req.qmCourse.userId,
        req.qmCourse.id,
        req.headers.cookie,
      );

      res.json({
        success: true,
        data: mapping,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/canvas/courses/:canvasCourseId/quizzes – fetches quizzes from a Canvas course. */
router.get(
  "/courses/:canvasCourseId/quizzes",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  async (req, res, next) => {
    try {
      const { canvasCourseId } = req.params;
      const quizzes = await getCanvasQuizzes(req.headers.cookie, canvasCourseId);

      res.json({
        success: true,
        data: quizzes,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions – lists Canvas quiz questions. */
router.get(
  "/courses/:canvasCourseId/quizzes/:quizId/questions",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  async (req, res, next) => {
    try {
      const { canvasCourseId, quizId } = req.params;
      const questions = await getCanvasQuizQuestions(req.headers.cookie, canvasCourseId, quizId);

      res.json({
        success: true,
        data: questions,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/canvas/import/:canvasCourseId/quizzes/:quizId – imports a Canvas quiz (course-scoped, instructor-only). */
router.post(
  "/import/:canvasCourseId/quizzes/:quizId",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireCourseAccess({ min: "instructor", getCourseId: (req) => req.body.localCourseId }),
  async (req, res, next) => {
    try {
      const { canvasCourseId, quizId } = req.params;
      const { assessmentType, assessmentName, primaryTopicId } = req.body;

      if (!primaryTopicId) {
        return res.status(400).json({
          success: false,
          error: "Primary topic ID is required for importing questions",
        });
      }

      // Eagerly confirm the topic exists and belongs to this course before
      // creating questions — otherwise the FK insert crashes mid-import (#7). A
      // supplied-but-nonexistent topic is a missing resource, so 404 (#3).
      const topic = await prisma.topics.findFirst({
        where: { id: primaryTopicId, courseId: req.qmCourse.id },
      });
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: "Primary topic not found in this course",
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
          primaryTopicId,
        },
        req.qmCourse.userId,
        req.headers.cookie,
      );

      res.json({
        success: true,
        message: "Quiz imported from Canvas successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/canvas/courses/:canvasCourseId/banks – lists Canvas Assessment Question Banks. */
router.get(
  "/courses/:canvasCourseId/banks",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  async (req, res, next) => {
    try {
      let canvasCourseId;
      try {
        canvasCourseId = parseCanvasNumericId(req.params.canvasCourseId, "canvasCourseId");
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
      const banks = await getCanvasQuestionBanks(req.headers.cookie, canvasCourseId);
      res.json({ success: true, data: banks });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/canvas/courses/:canvasCourseId/banks/:canvasBankId/questions */
router.get(
  "/courses/:canvasCourseId/banks/:canvasBankId/questions",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  async (req, res, next) => {
    try {
      let canvasBankId;
      try {
        parseCanvasNumericId(req.params.canvasCourseId, "canvasCourseId");
        canvasBankId = parseCanvasNumericId(req.params.canvasBankId, "canvasBankId");
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
      const { questions, truncated } = await getCanvasQuestionBankQuestions(
        req.headers.cookie,
        canvasBankId,
      );
      res.json({ success: true, data: questions, truncated });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/canvas/import/:canvasCourseId/banks/:canvasBankId – sync Canvas bank → Core bank. */
router.post(
  "/import/:canvasCourseId/banks/:canvasBankId",
  authenticateToken,
  requireRole(CANVAS_ROLES),
  requireCourseAccess({ min: "instructor", getCourseId: (req) => req.body.localCourseId }),
  async (req, res, next) => {
    try {
      let canvasCourseId;
      let canvasBankId;
      try {
        canvasCourseId = parseCanvasNumericId(req.params.canvasCourseId, "canvasCourseId");
        canvasBankId = parseCanvasNumericId(req.params.canvasBankId, "canvasBankId");
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
      const { primaryTopicId, targetBankId } = req.body;

      if (!primaryTopicId) {
        return res.status(400).json({
          success: false,
          error: "Primary topic ID is required for importing questions",
        });
      }

      const topic = await prisma.topics.findFirst({
        where: { id: String(primaryTopicId), courseId: req.qmCourse.id },
      });
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: "Primary topic not found in this course",
        });
      }

      const result = await importQuestionBankFromCanvas(
        req.user.id,
        canvasCourseId,
        canvasBankId,
        req.qmCourse.id,
        {
          primaryTopicId: String(primaryTopicId),
          targetBankId: targetBankId ? String(targetBankId) : undefined,
        },
        req.qmCourse.userId,
        req.headers.cookie,
      );

      res.json({
        success: true,
        message: "Question bank synced from Canvas successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
