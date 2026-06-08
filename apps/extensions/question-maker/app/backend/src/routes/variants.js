/**
 * Router for managing question variants (create/read/update/delete) tied to a question owner.
 * Shares questionService helpers and enforces authentication for every action.
 */
import express from 'express';
import {
  createVariant,
  updateVariant,
  deleteVariant,
  getVariantsByQuestion
} from '../services/questionService.js';
import { Variants, Question_Metadata, Course, Topics } from '../schema/index.js';
import { patchQuestionTestableOnCore } from '../services/coreApiService.js';
import { pushVariantToCore } from '../services/coreWiringService.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/** POST /api/questions/:id/variants – creates a variant under the given question after validation. */
router.post('/:id/variants', authenticateToken, async (req, res, next) => {
  try {
    const { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft } = req.body;

    if (!questionText || !questionText.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Question text is required'
      });
    }

    const variant = await createVariant(
      req.params.id,
      {
        questionText: questionText.trim(),
        difficulty,
        reasoningLevel,
        assessmentId,
        secondaryTopicsId,
        answer,
        choices,
        referenceId,
        isAiGenerated,
        isDraft
      },
      req.user.id
    );

    res.status(201).json({
      success: true,
      message: 'Variant created successfully',
      data: variant
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/questions/:id/variants – returns all variants for a question owned by the user. */
router.get('/:id/variants', authenticateToken, async (req, res, next) => {
  try {
    const variants = await getVariantsByQuestion(req.params.id, req.user.id);

    res.json({
      success: true,
      data: variants
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/questions/variants/:variantId – updates variant content, difficulty, and metadata. Triggers Core push on approval. */
router.put('/variants/:variantId', authenticateToken, async (req, res, next) => {
  try {
    const { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft: isDraftRaw } = req.body;
    const isDraft = isDraftRaw === true || isDraftRaw === 'true' ? true
                  : isDraftRaw === false || isDraftRaw === 'false' ? false
                  : isDraftRaw;

    const variant = await updateVariant(
      req.params.variantId,
      { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft },
      req.user.id
    );

    // State-based push: fires whenever the caller sets isDraft=false and the variant is not yet
    // linked to Core. The stable idempotencyKey makes repeated calls to Core safe.
    if (isDraft === false && variant.isDraft === false && !variant.coreQuestionId) {
      const course = variant.questionMetadata?.course;
      if (course?.coreCourseId) {
        try {
          const pushResult = await pushVariantToCore(variant, course, req.headers.cookie);
          await variant.update({ coreQuestionId: pushResult.coreQuestionId });
        } catch (coreErr) {
          if (coreErr.status === 422) {
            const errBody = coreErr.body ?? {};
            if (errBody.error === 'INVALID_TOPIC_IDS' && Array.isArray(errBody.deletedTopicIds) && errBody.deletedTopicIds.length > 0) {
              await Topics.update({ coreTopicId: null }, { where: { coreTopicId: errBody.deletedTopicIds } });
              return res.status(422).json({
                success: false,
                error: 'INVALID_TOPIC_IDS',
                message: 'Some topics have been deleted in Core. Please update topic assignments and re-approve.',
                deletedTopicIds: errBody.deletedTopicIds
              });
            }
            if (errBody.error === 'DUPLICATE_TOPIC') {
              return res.status(422).json({
                success: false,
                error: 'DUPLICATE_TOPIC',
                message: 'The primary topic also appears in secondary topics. Fix the topic list and re-approve.'
              });
            }
          }
          logger.warn({ err: coreErr }, 'Core question push failed; variant approved locally without Core link');
        }
      }
    }

    res.json({
      success: true,
      message: 'Variant updated successfully',
      data: variant
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/questions/variants/:variantId/testable – proxies testable toggle to Core; nulls coreQuestionId on 404. */
router.patch('/variants/:variantId/testable', authenticateToken, async (req, res, next) => {
  try {
    const { testable } = req.body;

    if (typeof testable !== 'boolean') {
      return res.status(400).json({ success: false, error: 'testable must be a boolean' });
    }

    const variant = await Variants.findOne({
      where: { id: Number(req.params.variantId) },
      include: [{
        model: Question_Metadata,
        as: 'questionMetadata',
        include: [{ model: Course, as: 'course', where: { userId: req.user.id } }]
      }]
    });

    if (!variant) {
      return res.status(404).json({ success: false, error: 'Variant not found' });
    }

    if (!variant.coreQuestionId) {
      return res.status(400).json({ success: false, error: 'Variant has not been pushed to Core yet' });
    }

    const result = await patchQuestionTestableOnCore(variant.coreQuestionId, testable);

    if (result === null) {
      await variant.update({ coreQuestionId: null });
      return res.status(404).json({ success: false, error: 'QUESTION_NOT_FOUND' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/questions/variants/:variantId – removes a variant owned by the authenticated user. */
router.delete('/variants/:variantId', authenticateToken, async (req, res, next) => {
  try {
    await deleteVariant(req.params.variantId, req.user.id);

    res.json({
      success: true,
      message: 'Variant deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
