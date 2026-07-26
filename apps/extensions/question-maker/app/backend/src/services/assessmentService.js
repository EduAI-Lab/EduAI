/**
 * Assessment service encapsulating CRUD operations plus question/section associations.
 * Ensures user ownership via course joins and keeps question ordering metadata consistent.
 */
import { Assessments, Question_Metadata, Variants, AssessmentSections, SectionVariants, Course, sequelize } from '../schema/index.js';
import { Op } from 'sequelize';
import {
  enrichRowsWithCourse,
  enrichRowWithCourse,
  formatSemesterDisplay,
  deriveSemesterDisplayForCourseId
} from './courseListService.js';

/**
 * Overwrites the transitional `semester` column value with the display string
 * derived from the row's (already-enriched) course term/year (#1072 §4 step 8 /
 * #1077). `semester` is never trusted as authoritative on read — every returned
 * assessment recomputes it here.
 */
function withDerivedSemester(row) {
  if (!row) return row;
  return { ...row, semester: formatSemesterDisplay(row.course?.term, row.course?.year) };
}

/**
 * Creates an assessment blueprint for the given user/course after validating inputs.
 * `semester` is no longer accepted from callers, nor persisted — the `Assessments`
 * table dropped the column (#1072 §4 step 10/#1077). It's still derived from the
 * course's Core term for the immediate create-response (mirrors `withDerivedSemester`
 * for the read seams); pass `cookie` to read through as the caller when available
 * (falls back to the service key).
 */
export const createAssessment = async (userId, assessmentData, { cookie } = {}) => {
  try {
    const { type, name, courseId, description, blueprintConfig } = assessmentData;

    if (!type || !name) {
      throw new Error('Type and name are required');
    }

    if (!courseId) {
      throw new Error('Course ID is required');
    }

    const course = await Course.findOne({
      where: { id: courseId, userId },
      attributes: ['id']
    });

    if (!course) {
      throw new Error('Course not found');
    }

    const semesterDisplay = await deriveSemesterDisplayForCourseId(courseId, { cookie });

    const assessment = await Assessments.create({
      type,
      name,
      courseId,
      description: description?.trim() || null,
      blueprintConfig: blueprintConfig || null
    });

    return { ...assessment.toJSON(), semester: semesterDisplay };
  } catch (error) {
    throw error;
  }
};

/** Lists assessments owned by a user with optional filters and eager-loaded relations. */
export const getAssessmentsByUser = async (userId, options = {}) => {
  try {
    const { limit = 50, offset = 0, courseId, isAdmin = false } = options;

    // If user is admin without a courseId constraint, allow all assessments; otherwise scope to owner
    const courseWhere = isAdmin ? {} : { userId };

    const assessments = await Assessments.findAll({
      where: {
        ...(courseId && { courseId })
      },
      include: [
        {
          model: Course,
          as: 'course',
          // `coreCourseId` is what `enrichRowsWithCourse` needs to project
          // name/code from Core below — `Course` has no local name/code to
          // select anymore (#1072 §4 step 10).
          attributes: ['id', 'coreCourseId'],
          where: courseWhere,
          required: true
        },
        {
          model: Variants,
          as: 'variants',
          attributes: ['id', 'questionText', 'difficulty', 'answer', 'choices', 'questionMetadataId', 'isAiGenerated', 'isDraft'],
          include: [
            {
              model: Question_Metadata,
              as: 'questionMetadata',
              attributes: ['id', 'description', 'type', 'questionOrder'],
              include: [
                {
                  model: Course,
                  as: 'course',
                  where: { userId: userId },
                  // Ownership filter only — this nested course is never enriched/returned.
                  attributes: ['id']
                }
              ]
            }
          ]
        },
        {
          model: AssessmentSections,
          as: 'sections',
          include: [
            {
              model: SectionVariants,
              as: 'sectionVariants',
              include: [
                {
                  model: Variants,
                  as: 'variant',
                  attributes: ['id', 'questionText', 'difficulty', 'reasoningLevel', 'answer', 'choices', 'questionMetadataId', 'isAiGenerated', 'isDraft'],
                  include: [
                    {
                      model: Question_Metadata,
                      as: 'questionMetadata',
                      attributes: ['id', 'description', 'type', 'questionOrder'],
                      include: [
                        {
                          model: Course,
                          as: 'course',
                          // Ownership filter only — this nested course is never enriched/returned.
                          attributes: ['id'],
                          where: { userId },
                          required: false
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          order: [['position', 'ASC']]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const enriched = await enrichRowsWithCourse(assessments);
    return enriched.map(withDerivedSemester);
  } catch (error) {
    throw error;
  }
};

/** Fetches a single assessment with its sections/variants if the user owns it. */
export const getAssessmentById = async (assessmentId, userId) => {
  try {
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          // `coreCourseId` feeds `enrichRowWithCourse`'s Core projection below.
          attributes: ['id', 'coreCourseId'],
          where: { userId },
          required: true
        },
        {
          model: Variants,
          as: 'variants',
          attributes: ['id', 'questionText', 'difficulty', 'answer', 'choices', 'questionMetadataId', 'isAiGenerated', 'isDraft'],
          include: [
            {
              model: Question_Metadata,
              as: 'questionMetadata',
              attributes: ['id', 'description', 'type', 'questionOrder'],
              include: [
                {
                  model: Course,
                  as: 'course',
                  where: { userId: userId },
                  // Ownership filter only — this nested course is never enriched/returned.
                  attributes: ['id']
                }
              ]
            }
          ]
        },
        {
          model: AssessmentSections,
          as: 'sections',
          include: [
            {
              model: SectionVariants,
              as: 'sectionVariants',
              include: [
                {
                  model: Variants,
                  as: 'variant',
                  attributes: ['id', 'questionText', 'difficulty', 'reasoningLevel', 'answer', 'choices', 'questionMetadataId', 'isAiGenerated', 'isDraft'],
                  include: [
                    {
                      model: Question_Metadata,
                      as: 'questionMetadata',
                      attributes: ['id', 'description', 'type', 'questionOrder'],
                      include: [
                        {
                          model: Course,
                          as: 'course',
                          where: { userId },
                          // Ownership filter only — this nested course is never enriched/returned.
                          attributes: ['id'],
                          required: false
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    return withDerivedSemester(await enrichRowWithCourse(assessment));
  } catch (error) {
    throw error;
  }
};

/** Updates assessment metadata/blueprint while enforcing ownership and valid course references. */
export const updateAssessment = async (assessmentId, updateData, userId) => {
  try {
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId },
          required: true
        },
        {
          model: Variants,
          as: 'variants',
          include: [
            {
              model: Question_Metadata,
              as: 'questionMetadata',
              include: [
                {
                  model: Course,
                  as: 'course',
                  where: { userId: userId }
                }
              ]
            }
          ]
        }
      ]
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    if (updateData.courseId) {
      const targetCourse = await Course.findOne({
        where: { id: updateData.courseId, userId },
        attributes: ['id']
      });

      if (!targetCourse) {
        throw new Error('Course not found');
      }
    }

    // `semester` is derived-only (#1072 §4 step 8 / #1077) — never write it,
    // even if a legacy caller still sends one.
    const { semester: _ignoredSemester, ...updateFields } = updateData;
    const normalizedUpdates = {
      ...updateFields,
      description: updateData.description !== undefined
        ? (updateData.description?.trim() || null)
        : assessment.description,
      blueprintConfig: updateData.blueprintConfig !== undefined
        ? updateData.blueprintConfig
        : assessment.blueprintConfig
    };

    await assessment.update(normalizedUpdates);

    // `.update()` doesn't refresh the eager-loaded `course` association — if
    // the update moved the assessment to another course, reload with the
    // course include so the response's course/semester projection describes
    // the NEW course, not the one loaded at the top.
    if (updateData.courseId) {
      await assessment.reload({ include: [{ model: Course, as: 'course' }] });
    }

    return withDerivedSemester(await enrichRowWithCourse(assessment));
  } catch (error) {
    throw error;
  }
};

/** Deletes an assessment and detaches any variants tied to it to keep data consistent. */
export const deleteAssessment = async (assessmentId, userId) => {
  try {
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId },
          required: true
        },
        {
          model: Variants,
          as: 'variants',
          include: [
            {
              model: Question_Metadata,
              as: 'questionMetadata',
              include: [
                {
                  model: Course,
                  as: 'course',
                  where: { userId: userId }
                }
              ]
            }
          ]
        }
      ]
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Clear assessmentId from all variants linked to this assessment
    await Variants.update(
      { assessmentId: null },
      { where: { assessmentId: assessmentId } }
    );

    await assessment.destroy();
    return true;
  } catch (error) {
    throw error;
  }
};

/** Adds a question to an assessment by updating its per-assessment `questionOrder`. */
export const addQuestionToAssessment = async (assessmentId, questionId, orderNumber, userId) => {
  try {
    // Verify user owns the question
    const question = await Question_Metadata.findOne({
      where: { id: questionId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId }
        }
      ]
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment exists and belongs to user
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId },
          attributes: ['id']
        }
      ]
    });
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // The question and assessment must live in the same course — owner scoping alone
    // would let a question from another course the user owns be linked here (#1).
    if (question.courseId !== assessment.courseId) {
      throw new Error('Question not found');
    }

    // Update question order
    const currentOrder = question.questionOrder || {};
    currentOrder[assessmentId] = orderNumber;
    
    await question.update({ questionOrder: currentOrder });

    return question;
  } catch (error) {
    throw error;
  }
};

/** Removes a question from an assessment's ordering payload after verifying ownership. */
export const removeQuestionFromAssessment = async (assessmentId, questionId, userId) => {
  try {
    // Verify user owns the question
    const question = await Question_Metadata.findOne({
      where: { id: questionId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId }
        }
      ]
    });

    if (!question) {
      throw new Error('Question not found');
    }

    // Verify assessment belongs to the user
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId },
          attributes: ['id']
        }
      ]
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // The question and assessment must live in the same course (#1).
    if (question.courseId !== assessment.courseId) {
      throw new Error('Question not found');
    }

    // Remove from question order
    const currentOrder = question.questionOrder || {};
    delete currentOrder[assessmentId];
    
    await question.update({ questionOrder: currentOrder });

    return question;
  } catch (error) {
    throw error;
  }
};

/** Returns questions scheduled for a given assessment ordered by their stored display order. */
export const getQuestionsInAssessment = async (assessmentId, userId) => {
  try {
    // Verify assessment exists and belongs to user
    const assessment = await Assessments.findOne({
      where: { id: assessmentId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId },
          attributes: ['id']
        }
      ]
    });
    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all questions that have this assessment in their questionOrder
    const questions = await Question_Metadata.findAll({
      // `question_order` is a `json` column (not `jsonb`), so the `@>` containment
      // operator is unavailable. Use `->>` key extraction, which works on `json`
      // and mirrors the ORDER BY clause below.
      where: sequelize.where(
        sequelize.literal(`question_order ->> '${assessmentId}'`),
        { [Op.ne]: null }
      ),
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId },
          // Ownership filter only — this endpoint returns rows unenriched, and
          // `Course` has no local name/code to select anymore (#1072 §4 step 10).
          attributes: ['id']
        },
        {
          model: Variants,
          as: 'variants',
          where: { assessmentId: assessmentId },
          attributes: ['id', 'questionText', 'difficulty', 'answer', 'choices']
        }
      ],
      // `id` breaks ties so the ordering is total (#1044). The display order in
      // `question_order` is not guaranteed unique — a bulk add writes the same
      // index to several rows — and without a tiebreak tied rows can shuffle
      // between requests, so a LIMIT/OFFSET page can repeat and drop them.
      order: [
        [sequelize.literal(`CAST(question_order->>'${assessmentId}' AS INTEGER)`), 'ASC'],
        ['id', 'ASC']
      ]
    });

    return questions;
  } catch (error) {
    throw error;
  }
};
