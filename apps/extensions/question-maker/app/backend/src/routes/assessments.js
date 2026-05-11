/**
 * Router that handles assessment CRUD, section management, and variant linkage for authenticated users.
 * Orchestrates calls to assessmentService and assessmentSectionService while enforcing ownership checks.
 */
import express from 'express';
import { 
  createAssessment, 
  getAssessmentsByUser, 
  getAssessmentById, 
  updateAssessment, 
  deleteAssessment,
  addQuestionToAssessment,
  removeQuestionFromAssessment,
  getQuestionsInAssessment
} from '../services/assessmentService.js';
import {
  getSectionsForAssessment,
  createAssessmentSection,
  updateAssessmentSection,
  deleteAssessmentSection,
  addVariantToSection,
  removeVariantFromSection,
  updateVariantOrderInSection,
  removeQuestionFromAllSections,
  checkQuestionInAssessments
} from '../services/assessmentSectionService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/** POST /api/assessments – creates an assessment for the authenticated instructor, validating required fields. */
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { type, name, semester, description, courseId, blueprintConfig } = req.body;

    if (!type || !name || !semester || !courseId) {
      return res.status(400).json({
        success: false,
        error: 'Type, name, semester, and courseId are required'
      });
    }

    const assessment = await createAssessment(req.user.id, {
      type,
      name,
      semester,
      description,
      courseId,
      blueprintConfig
    });

    res.status(201).json({
      success: true,
      message: 'Assessment created successfully',
      data: assessment
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments – lists assessments for the user with optional pagination/course filters. */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { limit, offset, courseId } = req.query;

    const assessments = await getAssessmentsByUser(req.user.id, {
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      courseId: courseId ? Number(courseId) : undefined
    });

    res.json({
      success: true,
      data: assessments
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments/:id – fetches a single assessment if it belongs to the requester. */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const assessment = await getAssessmentById(req.params.id, req.user.id);

    res.json({
      success: true,
      data: assessment
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/assessments/:id – updates assessment metadata/blueprint after ownership verification. */
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { type, name, semester, description, courseId, blueprintConfig } = req.body;

    const assessment = await updateAssessment(req.params.id, {
      type,
      name,
      semester,
      description,
      courseId,
      blueprintConfig
    }, req.user.id);

    res.json({
      success: true,
      message: 'Assessment updated successfully',
      data: assessment
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:id – deletes the specified assessment if owned by the user. */
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await deleteAssessment(req.params.id, req.user.id);

    res.json({
      success: true,
      message: 'Assessment deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:id/questions – links a question to an assessment with a specific order slot. */
router.post('/:id/questions', authenticateToken, async (req, res, next) => {
  try {
    const { questionId, orderNumber } = req.body;

    if (!questionId || orderNumber === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Question ID and order number are required'
      });
    }

    const question = await addQuestionToAssessment(
      req.params.id, 
      questionId, 
      orderNumber, 
      req.user.id
    );

    res.json({
      success: true,
      message: 'Question added to assessment successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:id/questions/:questionId – unlinks a question from the assessment. */
router.delete('/:id/questions/:questionId', authenticateToken, async (req, res, next) => {
  try {
    const question = await removeQuestionFromAssessment(
      req.params.id, 
      req.params.questionId, 
      req.user.id
    );

    res.json({
      success: true,
      message: 'Question removed from assessment successfully',
      data: question
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments/:id/questions – returns all questions associated with the assessment. */
router.get('/:id/questions', authenticateToken, async (req, res, next) => {
  try {
    const questions = await getQuestionsInAssessment(req.params.id, req.user.id);

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

// Section routes
/** GET /api/assessments/:id/sections – lists all sections tied to the assessment for the user. */
router.get('/:id/sections', authenticateToken, async (req, res, next) => {
  try {
    const sections = await getSectionsForAssessment(req.params.id, req.user.id);
    res.json({ success: true, data: sections });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:id/sections – creates a new section definition under the assessment. */
router.post('/:id/sections', authenticateToken, async (req, res, next) => {
  try {
    const section = await createAssessmentSection(req.params.id, req.user.id, req.body);
    res.status(201).json({
      success: true,
      message: 'Section created successfully',
      data: section
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/assessments/:assessmentId/sections/:sectionId – updates section metadata or filters. */
router.put('/:assessmentId/sections/:sectionId', authenticateToken, async (req, res, next) => {
  try {
    const section = await updateAssessmentSection(req.params.sectionId, req.user.id, req.body);
    res.json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:assessmentId/sections/:sectionId – removes the section and its links. */
router.delete('/:assessmentId/sections/:sectionId', authenticateToken, async (req, res, next) => {
  try {
    await deleteAssessmentSection(req.params.sectionId, req.user.id);
    res.json({
      success: true,
      message: 'Section deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:assessmentId/sections/:sectionId/variants – attaches a question variant to the section. */
router.post('/:assessmentId/sections/:sectionId/variants', authenticateToken, async (req, res, next) => {
  try {
    const { variantId, displayOrder, metadata } = req.body;

    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: 'variantId is required'
      });
    }

    const link = await addVariantToSection(
      req.params.sectionId,
      req.user.id,
      Number(variantId),
      { displayOrder, metadata }
    );

    res.status(201).json({
      success: true,
      message: 'Variant added to section successfully',
      data: link
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId/order – updates the display order of a variant link. */
router.put('/:assessmentId/sections/:sectionId/variants/:variantId/order', authenticateToken, async (req, res, next) => {
  try {
    const { displayOrder } = req.body;

    if (displayOrder === undefined) {
      return res.status(400).json({
        success: false,
        error: 'displayOrder is required'
      });
    }

    const link = await updateVariantOrderInSection(
      req.params.sectionId,
      req.user.id,
      Number(req.params.variantId),
      Number(displayOrder)
    );

    res.json({
      success: true,
      message: 'Variant order updated successfully',
      data: link
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId – removes a variant from the section. */
router.delete('/:assessmentId/sections/:sectionId/variants/:variantId', authenticateToken, async (req, res, next) => {
  try {
    await removeVariantFromSection(
      req.params.sectionId,
      req.user.id,
      Number(req.params.variantId)
    );

    res.json({
      success: true,
      message: 'Variant removed from section successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments/questions/:questionId/check-in-assessments – determines whether a question appears in any sections. */
router.get('/questions/:questionId/check-in-assessments', authenticateToken, async (req, res, next) => {
  try {
    const result = await checkQuestionInAssessments(
      Number(req.params.questionId),
      req.user.id
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/questions/:questionId/remove-from-all-sections – bulk removes a question from every section it appears in. */
router.delete('/questions/:questionId/remove-from-all-sections', authenticateToken, async (req, res, next) => {
  try {
    const result = await removeQuestionFromAllSections(
      Number(req.params.questionId),
      req.user.id
    );

    res.json({
      success: true,
      message: 'Question removed from all sections successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

export default router;
