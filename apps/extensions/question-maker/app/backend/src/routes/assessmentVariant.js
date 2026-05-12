/**
 * Routes for the assessment variant workflow (API path `/api/assessment-variant`).
 */
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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

/** PATCH /api/assessment-variant/assessments/:id/role — set blueprintConfig.studyRole for an assessment. */
router.patch('/assessments/:id/role', authenticateToken, async (req, res, next) => {
  try {
    if (!('studyRole' in req.body)) {
      return res.status(400).json({
        success: false,
        error: 'studyRole is required (string or null to clear)'
      });
    }
    const studyRole = req.body.studyRole;
    const assessment = await setAssessmentStudyRole(Number(req.params.id), req.user.id, studyRole);
    res.json({ success: true, data: assessment });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessment-variant/assessments/:id/blueprint-snapshot — ordered slots + aggregates for a reference exam. */
router.get('/assessments/:id/blueprint-snapshot', authenticateToken, async (req, res, next) => {
  try {
    const snapshot = await getBlueprintSnapshot(Number(req.params.id), req.user.id);
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessment-variant/assessments/:id/variant-readiness?courseId= */
router.get('/assessments/:id/variant-readiness', authenticateToken, async (req, res, next) => {
  try {
    const courseId = req.query.courseId;
    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'courseId query parameter is required'
      });
    }
    const data = await getBaselineVariantReadiness(req.user.id, {
      assessmentId: Number(req.params.id),
      courseId: Number(courseId)
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessment-variant/assemble-variants */
router.post('/assemble-variants', authenticateToken, async (req, res, next) => {
  try {
    const {
      referenceAssessmentId,
      courseId,
      examLabels,
      namePrefix,
      includeDrafts,
      semesterOverride,
      assessmentTypeOverride
    } = req.body;

    if (!referenceAssessmentId || !courseId) {
      return res.status(400).json({
        success: false,
        error: 'referenceAssessmentId and courseId are required'
      });
    }

    const result = await assembleEquivalentExamVariants(req.user.id, {
      referenceAssessmentId: Number(referenceAssessmentId),
      courseId: Number(courseId),
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

/** POST /api/assessment-variant/assemble-by-metadata */
router.post('/assemble-by-metadata', authenticateToken, async (req, res, next) => {
  try {
    const {
      referenceAssessmentId,
      courseId,
      examLabels,
      namePrefix,
      includeDrafts,
      semesterOverride,
      assessmentTypeOverride
    } = req.body;

    if (!referenceAssessmentId || !courseId) {
      return res.status(400).json({
        success: false,
        error: 'referenceAssessmentId and courseId are required'
      });
    }

    const result = await assembleExamVariantsByMetadataSimilarity(req.user.id, {
      referenceAssessmentId: Number(referenceAssessmentId),
      courseId: Number(courseId),
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

/** POST /api/assessment-variant/generate-bank-variants */
router.post('/generate-bank-variants', authenticateToken, async (req, res, next) => {
  try {
    const { questionIds, courseId, model, apiKeys, variantsToAdd, variantPromptInstructions } = req.body;

    if (!courseId || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'courseId and questionIds (non-empty array) are required'
      });
    }

    const result = await generateBankVariantsForQuestions(req.user.id, {
      questionIds: questionIds.map(Number),
      courseId: Number(courseId),
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

/** POST /api/assessment-variant/review-variant-ai */
router.post('/review-variant-ai', authenticateToken, async (req, res, next) => {
  try {
    const { baselineAssessmentId, variantAssessmentId, courseId, model, apiKeys, rubricText, applyUsabilityPenalty, includeOverallSummary } = req.body;
    if (!baselineAssessmentId || !variantAssessmentId || !courseId) {
      return res.status(400).json({
        success: false,
        error: 'baselineAssessmentId, variantAssessmentId, and courseId are required'
      });
    }

    const data = await reviewVariantExamWithAi(req.user.id, {
      baselineAssessmentId: Number(baselineAssessmentId),
      variantAssessmentId: Number(variantAssessmentId),
      courseId: Number(courseId),
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
