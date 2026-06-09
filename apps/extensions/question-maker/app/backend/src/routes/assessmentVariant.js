/**
 * Routes for the assessment variant workflow (API path `/api/assessment-variant`).
 *
 * RBAC (rbac-matrix.md §17, issue #313): assembling A/B/C forms, generating bank
 * variants, and AI review are instructor-only; blueprint snapshots and variant
 * readiness are TA-viewable. Service scoping keys off the authorized course's
 * owner id (`req.qmCourse.userId`).
 */
import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { requireCourseAccess } from '../middleware/courseAccess.js';
import { requireAssessmentAccess } from '../middleware/resourceAccess.js';
import {
  setAssessmentStudyRole,
  getBlueprintSnapshot,
  getBaselineVariantReadiness,
  assembleEquivalentExamVariants,
  assembleExamVariantsByMetadataSimilarity,
  generateBankVariantsForQuestions,
  reviewVariantExamWithAi
} from '../services/assessmentVariantService.js';

const router = express.Router();

const AUTHORS = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR', 'TA'];
const INSTRUCTORS = ['ADMIN', 'UNIT_ADMIN', 'INSTRUCTOR'];

const writeByCourseBody = requireCourseAccess({ min: 'instructor', getCourseId: (req) => req.body.courseId });

/** PATCH /api/assessment-variant/assessments/:id/role — set blueprintConfig.studyRole (instructor-only). */
router.patch(
  '/assessments/:id/role',
  authenticateToken,
  requireRole(INSTRUCTORS),
  requireAssessmentAccess({ min: 'instructor' }),
  async (req, res, next) => {
    try {
      if (!('studyRole' in req.body)) {
        return res.status(400).json({
          success: false,
          error: 'studyRole is required (string or null to clear)'
        });
      }
      const studyRole = req.body.studyRole;
      const assessment = await setAssessmentStudyRole(Number(req.params.id), req.qmCourse.userId, studyRole);
      res.json({ success: true, data: assessment });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/assessment-variant/assessments/:id/blueprint-snapshot — ordered slots + aggregates (TA view). */
router.get(
  '/assessments/:id/blueprint-snapshot',
  authenticateToken,
  requireRole(AUTHORS),
  requireAssessmentAccess({ min: 'ta' }),
  async (req, res, next) => {
    try {
      const snapshot = await getBlueprintSnapshot(Number(req.params.id), req.qmCourse.userId);
      res.json({ success: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/assessment-variant/assessments/:id/variant-readiness?courseId= (TA view). */
router.get(
  '/assessments/:id/variant-readiness',
  authenticateToken,
  requireRole(AUTHORS),
  requireAssessmentAccess({ min: 'ta' }),
  async (req, res, next) => {
    try {
      const courseId = req.query.courseId;
      if (!courseId) {
        return res.status(400).json({
          success: false,
          error: 'courseId query parameter is required'
        });
      }
      const data = await getBaselineVariantReadiness(req.qmCourse.userId, {
        assessmentId: Number(req.params.id),
        courseId: Number(courseId)
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/assessment-variant/assemble-variants (instructor-only). */
router.post('/assemble-variants', authenticateToken, requireRole(INSTRUCTORS), writeByCourseBody, async (req, res, next) => {
  try {
    const {
      referenceAssessmentId,
      examLabels,
      namePrefix,
      includeDrafts,
      semesterOverride,
      assessmentTypeOverride
    } = req.body;

    if (!referenceAssessmentId) {
      return res.status(400).json({
        success: false,
        error: 'referenceAssessmentId and courseId are required'
      });
    }

    const result = await assembleEquivalentExamVariants(req.qmCourse.userId, {
      referenceAssessmentId: Number(referenceAssessmentId),
      courseId: req.qmCourse.id,
      examLabels: Array.isArray(examLabels) ? examLabels : undefined,
      namePrefix: typeof namePrefix === 'string' ? namePrefix : null,
      includeDrafts: Boolean(includeDrafts),
      semesterOverride: typeof semesterOverride === 'string' ? semesterOverride : null,
      assessmentTypeOverride: assessmentTypeOverride || null
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessment-variant/assemble-by-metadata (instructor-only). */
router.post('/assemble-by-metadata', authenticateToken, requireRole(INSTRUCTORS), writeByCourseBody, async (req, res, next) => {
  try {
    const {
      referenceAssessmentId,
      examLabels,
      namePrefix,
      includeDrafts,
      semesterOverride,
      assessmentTypeOverride
    } = req.body;

    if (!referenceAssessmentId) {
      return res.status(400).json({
        success: false,
        error: 'referenceAssessmentId and courseId are required'
      });
    }

    const result = await assembleExamVariantsByMetadataSimilarity(req.qmCourse.userId, {
      referenceAssessmentId: Number(referenceAssessmentId),
      courseId: req.qmCourse.id,
      examLabels: Array.isArray(examLabels) ? examLabels : undefined,
      namePrefix: typeof namePrefix === 'string' ? namePrefix : null,
      includeDrafts: includeDrafts !== false,
      semesterOverride: typeof semesterOverride === 'string' ? semesterOverride : null,
      assessmentTypeOverride: assessmentTypeOverride || null
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessment-variant/generate-bank-variants (instructor-only). */
router.post('/generate-bank-variants', authenticateToken, requireRole(INSTRUCTORS), writeByCourseBody, async (req, res, next) => {
  try {
    const { questionIds, model, apiKeys, variantsToAdd, variantPromptInstructions } = req.body;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'courseId and questionIds (non-empty array) are required'
      });
    }

    const result = await generateBankVariantsForQuestions(req.qmCourse.userId, {
      questionIds: questionIds.map(Number),
      courseId: req.qmCourse.id,
      model: typeof model === 'string' ? model : undefined,
      apiKeys: apiKeys && typeof apiKeys === 'object' ? apiKeys : {},
      variantsToAdd: variantsToAdd != null ? Number(variantsToAdd) : 1,
      variantPromptInstructions: typeof variantPromptInstructions === 'string' ? variantPromptInstructions : null
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessment-variant/review-variant-ai (instructor-only). */
router.post('/review-variant-ai', authenticateToken, requireRole(INSTRUCTORS), writeByCourseBody, async (req, res, next) => {
  try {
    const { baselineAssessmentId, variantAssessmentId, model, apiKeys, rubricText, applyUsabilityPenalty, includeOverallSummary } = req.body;
    if (!baselineAssessmentId || !variantAssessmentId) {
      return res.status(400).json({
        success: false,
        error: 'baselineAssessmentId, variantAssessmentId, and courseId are required'
      });
    }

    const data = await reviewVariantExamWithAi(req.qmCourse.userId, {
      baselineAssessmentId: Number(baselineAssessmentId),
      variantAssessmentId: Number(variantAssessmentId),
      courseId: req.qmCourse.id,
      model: typeof model === 'string' ? model : undefined,
      apiKeys: apiKeys && typeof apiKeys === 'object' ? apiKeys : {},
      rubricText: typeof rubricText === 'string' ? rubricText : '',
      applyUsabilityPenalty: typeof applyUsabilityPenalty === 'boolean' ? applyUsabilityPenalty : undefined,
      includeOverallSummary: typeof includeOverallSummary === 'boolean' ? includeOverallSummary : undefined
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
