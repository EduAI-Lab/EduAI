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
import { authenticateToken } from '../middleware/auth.js';

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

/** PUT /api/questions/variants/:variantId – updates variant content, difficulty, and metadata. */
router.put('/variants/:variantId', authenticateToken, async (req, res, next) => {
  try {
    const { questionText, difficulty, reasoningLevel, assessmentId, secondaryTopicsId, answer, choices, referenceId, isAiGenerated, isDraft } = req.body;

    const variant = await updateVariant(
      req.params.variantId,
      {
        questionText,
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

    res.json({
      success: true,
      message: 'Variant updated successfully',
      data: variant
    });
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
