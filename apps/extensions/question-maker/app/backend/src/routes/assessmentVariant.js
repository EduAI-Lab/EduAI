/**
 * Routes for the assessment variant workflow (API path `/api/assessment-variant`).
 *
 * RBAC (rbac-matrix.md §17, issue #313): authoring routes are instructor-only,
 * while blueprint/readiness reads are TA-viewable. The latter use the
 * enrollment-aware assessment gate because Core identifies a course TA as a
 * platform STUDENT. Service scoping keys off the authorized course's owner id
 * (`req.qmCourse.userId`).
 */
import express from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { QM_AUTHORIZED } from "../middleware/roles.js";
import { requireCourseAccess } from "../middleware/courseAccess.js";
import { requireAssessmentAccess } from "../middleware/resourceAccess.js";
import {
  setAssessmentStudyRole,
  getBlueprintSnapshot,
  getBaselineVariantReadiness,
  assembleEquivalentExamVariants,
  assembleExamVariantsByMetadataSimilarity,
  generateBankVariantsForQuestions,
  reviewVariantExamWithAi,
} from "../services/assessmentVariantService.js";
import {
  qmAiProviderCallAdmission,
  qmAiUserRateLimit,
  validateBankVariantAdmission,
  validateReviewAdmission,
  isQmAiDeadlineError,
} from "../middleware/aiAdmission.js";

const router = express.Router();

const writeByCourseBody = requireCourseAccess({
  min: "instructor",
  getCourseId: (req) => req.body.courseId,
});

/** Body fields the role endpoint is allowed to touch — everything else is rejected (#5). */
const ROLE_ALLOWED_FIELDS = ["studyRole"];

const bankVariantAdmission = qmAiProviderCallAdmission({
  validate: validateBankVariantAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

const reviewVariantAdmission = qmAiProviderCallAdmission({
  validate: validateReviewAdmission,
  getCost: (req) => req.aiAdmission.providerCalls,
});

function sendStableAiFailure(res, error, fallbackCode) {
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
  return res.status(500).json({ success: false, error: "AI operation failed", code: fallbackCode });
}

/** PATCH /api/assessment-variant/assessments/:id/role — set blueprintConfig.studyRole (instructor-only). */
router.patch(
  "/assessments/:id/role",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireAssessmentAccess({ min: "instructor" }),
  async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};

      // Whitelist the writable fields so arbitrary JSON can't be injected into
      // blueprintConfig (#5). studyRole's enum is validated in the service layer.
      const unknownKeys = Object.keys(body).filter((k) => !ROLE_ALLOWED_FIELDS.includes(k));
      if (unknownKeys.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Unsupported field(s): ${unknownKeys.join(", ")}. Allowed: ${ROLE_ALLOWED_FIELDS.join(", ")}`,
        });
      }

      if (!("studyRole" in body)) {
        return res.status(400).json({
          success: false,
          error: "studyRole is required (string or null to clear)",
        });
      }
      const studyRole = body.studyRole;
      if (studyRole !== null && typeof studyRole !== "string") {
        return res.status(400).json({
          success: false,
          error: "studyRole must be a string or null",
        });
      }
      const assessment = await setAssessmentStudyRole(
        Number(req.params.id),
        req.qmCourse.userId,
        studyRole,
      );
      res.json({ success: true, data: assessment });
    } catch (error) {
      // The service enforces the studyRole enum; surface that as a 400 (#5).
      if (error?.message === "Invalid studyRole") {
        return res.status(400).json({ success: false, error: "Invalid studyRole" });
      }
      next(error);
    }
  },
);

/** GET /api/assessment-variant/assessments/:id/blueprint-snapshot — ordered slots + aggregates (TA view). */
router.get(
  "/assessments/:id/blueprint-snapshot",
  authenticateToken,
  requireAssessmentAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      const snapshot = await getBlueprintSnapshot(Number(req.params.id), req.qmCourse.userId);
      res.json({ success: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/assessment-variant/assessments/:id/variant-readiness (TA view; course derived from :id). */
router.get(
  "/assessments/:id/variant-readiness",
  authenticateToken,
  requireAssessmentAccess({ min: "ta" }),
  async (req, res, next) => {
    try {
      // Course is derived from the authorized assessment (req.qmCourse), not the
      // client-supplied ?courseId= which the access gate has already resolved.
      const data = await getBaselineVariantReadiness(req.qmCourse.userId, {
        assessmentId: Number(req.params.id),
        courseId: req.qmCourse.id,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/assessment-variant/assemble-variants (instructor-only). */
router.post(
  "/assemble-variants",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  writeByCourseBody,
  async (req, res, next) => {
    try {
      const {
        referenceAssessmentId,
        examLabels,
        namePrefix,
        includeDrafts,
        assessmentTypeOverride,
      } = req.body;

      if (!referenceAssessmentId) {
        return res.status(400).json({
          success: false,
          error: "referenceAssessmentId and courseId are required",
        });
      }

      const result = await assembleEquivalentExamVariants(req.qmCourse.userId, {
        referenceAssessmentId: Number(referenceAssessmentId),
        courseId: req.qmCourse.id,
        examLabels: Array.isArray(examLabels) ? examLabels : undefined,
        namePrefix: typeof namePrefix === "string" ? namePrefix : null,
        includeDrafts: Boolean(includeDrafts),
        assessmentTypeOverride: assessmentTypeOverride || null,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/assessment-variant/assemble-by-metadata (instructor-only). */
router.post(
  "/assemble-by-metadata",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  writeByCourseBody,
  async (req, res, next) => {
    try {
      const {
        referenceAssessmentId,
        examLabels,
        namePrefix,
        includeDrafts,
        assessmentTypeOverride,
      } = req.body;

      if (!referenceAssessmentId) {
        return res.status(400).json({
          success: false,
          error: "referenceAssessmentId and courseId are required",
        });
      }

      const result = await assembleExamVariantsByMetadataSimilarity(req.qmCourse.userId, {
        referenceAssessmentId: Number(referenceAssessmentId),
        courseId: req.qmCourse.id,
        examLabels: Array.isArray(examLabels) ? examLabels : undefined,
        namePrefix: typeof namePrefix === "string" ? namePrefix : null,
        includeDrafts: includeDrafts !== false,
        assessmentTypeOverride: assessmentTypeOverride || null,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/assessment-variant/generate-bank-variants (instructor-only). */
router.post(
  "/generate-bank-variants",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  qmAiUserRateLimit,
  bankVariantAdmission,
  writeByCourseBody,
  async (req, res, next) => {
    try {
      const { model, apiKeys, variantPromptInstructions } = req.body;
      const { questionIds, variantsToAdd } = req.aiAdmission;

      const result = await generateBankVariantsForQuestions(req.qmCourse.userId, {
        questionIds,
        courseId: req.qmCourse.id,
        model: typeof model === "string" ? model : undefined,
        apiKeys: apiKeys && typeof apiKeys === "object" ? apiKeys : {},
        variantsToAdd,
        variantPromptInstructions:
          typeof variantPromptInstructions === "string" ? variantPromptInstructions : null,
        cookie: req.headers.cookie ?? "",
        signal: req.aiOperation?.signal,
        deadlineAt: req.aiOperation?.deadlineAt,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (
        Number(error?.statusCode ?? error?.status) === 429 ||
        isQmAiDeadlineError(error) ||
        Number(error?.statusCode ?? error?.status) === 504
      ) {
        return sendStableAiFailure(res, error, "EDUAI_BANK_VARIANT_FAILED");
      }
      next(error);
    }
  },
);

/** POST /api/assessment-variant/review-variant-ai (instructor-only). */
router.post(
  "/review-variant-ai",
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  qmAiUserRateLimit,
  reviewVariantAdmission,
  writeByCourseBody,
  async (req, res, next) => {
    try {
      const { model, apiKeys, rubricText, applyUsabilityPenalty } = req.body;
      const { baselineAssessmentId, variantAssessmentId, includeOverallSummary } = req.aiAdmission;

      const data = await reviewVariantExamWithAi(req.qmCourse.userId, {
        baselineAssessmentId,
        variantAssessmentId,
        courseId: req.qmCourse.id,
        model: typeof model === "string" ? model : undefined,
        apiKeys: apiKeys && typeof apiKeys === "object" ? apiKeys : {},
        rubricText: typeof rubricText === "string" ? rubricText : "",
        applyUsabilityPenalty:
          typeof applyUsabilityPenalty === "boolean" ? applyUsabilityPenalty : undefined,
        includeOverallSummary:
          typeof includeOverallSummary === "boolean" ? includeOverallSummary : undefined,
        cookie: req.headers.cookie ?? "",
        signal: req.aiOperation?.signal,
        deadlineAt: req.aiOperation?.deadlineAt,
      });

      res.json({ success: true, data });
    } catch (error) {
      if (
        Number(error?.statusCode ?? error?.status) === 429 ||
        isQmAiDeadlineError(error) ||
        Number(error?.statusCode ?? error?.status) === 504
      ) {
        return sendStableAiFailure(res, error, "EDUAI_VARIANT_REVIEW_FAILED");
      }
      next(error);
    }
  },
);

export default router;
