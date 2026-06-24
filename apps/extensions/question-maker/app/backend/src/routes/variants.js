/**
 * Router for managing question variants (create/read/update/delete).
 *
 * RBAC (rbac-matrix.md §16 + §19, issues #311/#312):
 *  - Flat role gate blocks STUDENT before any Core call.
 *  - Per-course access gate (requireQuestionAccess / requireVariantAccess) admits
 *    ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C) and pins `req.qmCourse`.
 *  - Resource semantics (#312): TA own-only edit/delete, instructor-only approval
 *    (isDraft:false), and the approved-variant 409 lock.
 * Course scoping in the service layer keys off the authorized course's owner id
 * (`req.qmCourse.userId`); authorization itself is the middleware's job.
 */
import express from 'express';
import {
  createVariant,
  updateVariant,
  deleteVariant,
  getVariantsByQuestion
} from '../services/questionService.js';
import { Topics } from '../schema/index.js';
import { patchQuestionTestableOnCore } from '../services/coreApiService.js';
import { pushVariantToCore } from '../services/coreWiringService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { QM_AUTHORIZED } from '../middleware/roles.js';
import { requireQuestionAccess, requireVariantAccess } from '../middleware/resourceAccess.js';
import { LEVELS } from '../middleware/courseAccess.js';
import { logger } from '../utils/logger.js';

const router = express.Router();


/** Coerce a raw isDraft value to a strict boolean, or undefined when absent. */
function parseIsDraft(raw) {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return undefined;
}

/** POST /api/questions/:id/variants – creates a variant under the given question after validation. */
router.post(
  '/:id/variants',
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireQuestionAccess({ min: 'ta' }),
  async (req, res, next) => {
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
          isDraft,
          createdBy: req.user.id
        },
        req.qmCourse.userId
      );

      res.status(201).json({
        success: true,
        message: 'Variant created successfully',
        data: variant
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/questions/:id/variants – returns all variants for a question the caller can access. */
router.get(
  '/:id/variants',
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireQuestionAccess({ min: 'ta' }),
  async (req, res, next) => {
    try {
      const variants = await getVariantsByQuestion(req.params.id, req.qmCourse.userId);

      res.json({
        success: true,
        data: variants
      });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /api/questions/variants/:variantId – updates variant content. Enforces #312 semantics; triggers Core push on approval. */
router.put(
  '/variants/:variantId',
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireVariantAccess({ min: 'ta' }),
  async (req, res, next) => {
    try {
      const { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft: isDraftRaw } = req.body;
      const isDraft = parseIsDraft(isDraftRaw);

      const current = req.variant;
      const access = req.courseAccess;
      const isInstructorPlus = access.rank >= LEVELS.instructor.rank;

      // §19 approved-variant lock: once approved, content edits are blocked except
      // reverting to draft (instructor+) or toggling the AI-generated tag.
      if (current.isDraft === false) {
        const reverting = isDraft === true && isInstructorPlus;
        const aiTagOnly =
          isAiGenerated !== undefined &&
          isDraftRaw === undefined &&
          questionText === undefined &&
          difficulty === undefined &&
          reasoningLevel === undefined &&
          assessmentId === undefined &&
          secondaryTopicsId === undefined &&
          answer === undefined &&
          choices === undefined &&
          referenceId === undefined;
        if (!reverting && !aiTagOnly) {
          return res.status(409).json({ success: false, error: 'VARIANT_LOCKED' });
        }
      } else {
        // Draft branch — instructor-only approval (§16).
        if (isDraft === false && !isInstructorPlus) {
          return res.status(403).json({ success: false, error: 'Only instructors can approve variants' });
        }
        // §19 TA own-only edit: a TA may edit only a draft they created.
        if (access.level === 'ta' && current.createdBy !== req.user.id) {
          return res.status(403).json({ success: false, error: 'TAs can only edit their own variants' });
        }
      }

      const variant = await updateVariant(
        req.params.variantId,
        { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft },
        req.qmCourse.userId
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
  }
);

/** PATCH /api/questions/variants/:variantId/testable – proxies testable toggle to Core; nulls coreQuestionId on 404. */
router.patch(
  '/variants/:variantId/testable',
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireVariantAccess({ min: 'instructor' }),
  async (req, res, next) => {
    try {
      const { testable } = req.body;

      if (typeof testable !== 'boolean') {
        return res.status(400).json({ success: false, error: 'testable must be a boolean' });
      }

      const variant = req.variant;

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
  }
);

/** DELETE /api/questions/variants/:variantId – removes a variant; TAs may delete only their own. */
router.delete(
  '/variants/:variantId',
  authenticateToken,
  requireRole(QM_AUTHORIZED),
  requireVariantAccess({ min: 'ta' }),
  async (req, res, next) => {
    try {
      // §19 TA own-only delete (null createdBy = no owner → TA denied).
      if (req.courseAccess.level === 'ta' && req.variant.createdBy !== req.user.id) {
        return res.status(403).json({ success: false, error: 'TAs can only delete their own variants' });
      }

      await deleteVariant(req.params.variantId, req.qmCourse.userId);

      res.json({
        success: true,
        message: 'Variant deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
