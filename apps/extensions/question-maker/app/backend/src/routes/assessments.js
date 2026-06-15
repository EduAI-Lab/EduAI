/**
 * Router for assessment CRUD, section management, and variant linkage.
 *
 * RBAC (rbac-matrix.md §17, issue #313): assessment authoring is instructor-only
 * (ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C)); TAs may VIEW assembled assessments
 * but not mutate them. Reads use min 'ta'; writes use min 'instructor'. The
 * flat role gate (AUTHORS) blocks STUDENT up front; service scoping keys off the
 * authorized course's owner id (`req.qmCourse.userId`) and, for section/variant/question
 * writes, its course id (`req.qmCourse.id`) so a child resource from another course the
 * same user owns can't be mutated cross-course (#1).
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
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { QM_AUTHORIZED } from '../middleware/roles.js';
import { requireCourseAccess, resolveCourseAccessWithCourse, LEVELS } from '../middleware/courseAccess.js';
import { requireAssessmentAccess, requireQuestionAccess } from '../middleware/resourceAccess.js';

const router = express.Router();

const QM_AUTHORIZED_ROLES = QM_AUTHORIZED;

// Convenience guards for the two access tiers used throughout this router.
const viewAssessment = requireAssessmentAccess({ min: 'ta' });
const writeAssessment = requireAssessmentAccess({ min: 'instructor' });
const writeAssessmentByAssessmentId = requireAssessmentAccess({ min: 'instructor', param: 'assessmentId' });

/** POST /api/assessments – creates an assessment for the authenticated instructor, validating required fields. */
router.post(
  '/',
  authenticateToken,
  requireRole(QM_AUTHORIZED_ROLES),
  requireCourseAccess({ min: 'instructor', getCourseId: (req) => req.body.courseId }),
  async (req, res, next) => {
    try {
      const { type, name, semester, description, blueprintConfig } = req.body;

      if (!type || !name || !semester) {
        return res.status(400).json({
          success: false,
          error: 'Type, name, semester, and courseId are required'
        });
      }

      const assessment = await createAssessment(req.qmCourse.userId, {
        type,
        name,
        semester,
        description,
        courseId: req.qmCourse.id,
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
  }
);

/**
 * GET /api/assessments – lists assessments.
 *
 * When a courseId is supplied (the UI's course view), any caller with view
 * access to that course — including an enrolled TA who doesn't own it — sees the
 * whole list: we verify course access (§17 view, min 'ta') and scope by the
 * course owner. Without a courseId the list stays caller-scoped to the user's
 * own courses.
 */
router.get('/', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), async (req, res, next) => {
  try {
    const { limit, offset, courseId } = req.query;

    let scopeUserId = req.user.id;
    let scopeCourseId = courseId ? Number(courseId) : undefined;

    if (scopeCourseId !== undefined) {
      const { course, access } = await resolveCourseAccessWithCourse(req.user, scopeCourseId, {
        cookie: req.headers.cookie
      });
      if (!course) {
        return res.status(404).json({ success: false, error: 'Course not found' });
      }
      if (!access || access.rank < LEVELS.ta.rank) {
        return res.status(403).json({ success: false, error: 'Insufficient course access' });
      }
      // Owner-scope so an enrolled non-owner viewer still sees the course's assessments.
      scopeUserId = course.userId;
      scopeCourseId = course.id;
    }

    const assessments = await getAssessmentsByUser(scopeUserId, {
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      courseId: scopeCourseId
    });

    res.json({
      success: true,
      data: assessments
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments/:id – fetches a single assessment; TA view-only allowed. */
router.get('/:id', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), viewAssessment, async (req, res, next) => {
  try {
    const assessment = await getAssessmentById(req.params.id, req.qmCourse.userId);

    res.json({
      success: true,
      data: assessment
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/assessments/:id – updates assessment metadata/blueprint (instructor-only). */
router.put('/:id', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessment, async (req, res, next) => {
  try {
    const { type, name, semester, description, courseId, blueprintConfig } = req.body;

    const assessment = await updateAssessment(req.params.id, {
      type,
      name,
      semester,
      description,
      courseId,
      blueprintConfig
    }, req.qmCourse.userId);

    res.json({
      success: true,
      message: 'Assessment updated successfully',
      data: assessment
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:id – deletes the specified assessment (instructor-only). */
router.delete('/:id', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessment, async (req, res, next) => {
  try {
    await deleteAssessment(req.params.id, req.qmCourse.userId);

    res.json({
      success: true,
      message: 'Assessment deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:id/questions – links a question to an assessment (instructor-only). */
router.post('/:id/questions', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessment, async (req, res, next) => {
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
      req.qmCourse.userId
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

/** DELETE /api/assessments/:id/questions/:questionId – unlinks a question (instructor-only). */
router.delete('/:id/questions/:questionId', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessment, async (req, res, next) => {
  try {
    const question = await removeQuestionFromAssessment(
      req.params.id,
      req.params.questionId,
      req.qmCourse.userId
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

/** GET /api/assessments/:id/questions – returns all questions associated with the assessment (TA view). */
router.get('/:id/questions', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), viewAssessment, async (req, res, next) => {
  try {
    const questions = await getQuestionsInAssessment(req.params.id, req.qmCourse.userId);

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
});

// Section routes
/** GET /api/assessments/:id/sections – lists all sections tied to the assessment (TA view). */
router.get('/:id/sections', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), viewAssessment, async (req, res, next) => {
  try {
    const sections = await getSectionsForAssessment(req.params.id, req.qmCourse.userId);
    res.json({ success: true, data: sections });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:id/sections – creates a new section (instructor-only). */
router.post('/:id/sections', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessment, async (req, res, next) => {
  try {
    const section = await createAssessmentSection(req.params.id, req.qmCourse.userId, req.body);
    res.status(201).json({
      success: true,
      message: 'Section created successfully',
      data: section
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/assessments/:assessmentId/sections/:sectionId – updates section metadata (instructor-only). */
router.put('/:assessmentId/sections/:sectionId', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessmentByAssessmentId, async (req, res, next) => {
  try {
    const section = await updateAssessmentSection(req.params.sectionId, req.qmCourse.userId, req.body, req.qmCourse.id);
    res.json({
      success: true,
      message: 'Section updated successfully',
      data: section
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/:assessmentId/sections/:sectionId – removes the section (instructor-only). */
router.delete('/:assessmentId/sections/:sectionId', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessmentByAssessmentId, async (req, res, next) => {
  try {
    await deleteAssessmentSection(req.params.sectionId, req.qmCourse.userId, req.qmCourse.id);
    res.json({
      success: true,
      message: 'Section deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/assessments/:assessmentId/sections/:sectionId/variants – attaches a variant (instructor-only). */
router.post('/:assessmentId/sections/:sectionId/variants', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessmentByAssessmentId, async (req, res, next) => {
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
      req.qmCourse.userId,
      Number(variantId),
      { displayOrder, metadata },
      req.qmCourse.id
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

/** PUT /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId/order – updates display order (instructor-only). */
router.put('/:assessmentId/sections/:sectionId/variants/:variantId/order', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessmentByAssessmentId, async (req, res, next) => {
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
      req.qmCourse.userId,
      Number(req.params.variantId),
      Number(displayOrder),
      req.qmCourse.id
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

/** DELETE /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId – removes a variant from the section (instructor-only). */
router.delete('/:assessmentId/sections/:sectionId/variants/:variantId', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), writeAssessmentByAssessmentId, async (req, res, next) => {
  try {
    await removeVariantFromSection(
      req.params.sectionId,
      req.qmCourse.userId,
      Number(req.params.variantId),
      req.qmCourse.id
    );

    res.json({
      success: true,
      message: 'Variant removed from section successfully'
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/assessments/questions/:questionId/check-in-assessments – whether a question appears in any sections (TA view). */
router.get('/questions/:questionId/check-in-assessments', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), requireQuestionAccess({ min: 'ta', param: 'questionId' }), async (req, res, next) => {
  try {
    const result = await checkQuestionInAssessments(
      Number(req.params.questionId),
      req.qmCourse.userId
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/assessments/questions/:questionId/remove-from-all-sections – bulk removes a question (instructor-only). */
router.delete('/questions/:questionId/remove-from-all-sections', authenticateToken, requireRole(QM_AUTHORIZED_ROLES), requireQuestionAccess({ min: 'instructor', param: 'questionId' }), async (req, res, next) => {
  try {
    const result = await removeQuestionFromAllSections(
      Number(req.params.questionId),
      req.qmCourse.userId
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
