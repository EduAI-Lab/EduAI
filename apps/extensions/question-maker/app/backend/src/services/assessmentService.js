/**
 * Assessment service encapsulating CRUD operations plus question/section associations.
 * Ensures user ownership via course joins and keeps question ordering metadata consistent.
 */
import { Assessments, Question_Metadata, Variants, AssessmentSections, SectionVariants, Course, sequelize } from '../schema/index.js';
import { Op } from 'sequelize';

/** Creates an assessment blueprint for the given user/course after validating inputs. */
export const createAssessment = async (userId, assessmentData) => {
  try {
    const { type, name, semester, courseId, description, blueprintConfig } = assessmentData;

    if (!type || !name || !semester) {
      throw new Error('Type, name, and semester are required');
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

    const assessment = await Assessments.create({
      type,
      name,
      semester,
      courseId,
      description: description?.trim() || null,
      blueprintConfig: blueprintConfig || null
    });

    return assessment;
  } catch (error) {
    throw error;
  }
};

/** Lists assessments owned by a user with optional filters and eager-loaded relations. */
export const getAssessmentsByUser = async (userId, options = {}) => {
  try {
    const { limit = 50, offset = 0, courseId } = options;

    const assessments = await Assessments.findAll({
      where: {
        ...(courseId && { courseId })
      },
      include: [
        {
          model: Course,
          as: 'course',
          attributes: ['id', 'name', 'code'],
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
                  attributes: ['id', 'name', 'code']
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
                          attributes: ['id', 'name', 'code'],
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

    return assessments;
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
          attributes: ['id', 'name', 'code'],
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
                  attributes: ['id', 'name', 'code']
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
                          attributes: ['id', 'name', 'code'],
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

    return assessment;
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

    const normalizedUpdates = {
      ...updateData,
      description: updateData.description !== undefined
        ? (updateData.description?.trim() || null)
        : assessment.description,
      blueprintConfig: updateData.blueprintConfig !== undefined
        ? updateData.blueprintConfig
        : assessment.blueprintConfig
    };

    await assessment.update(normalizedUpdates);
    return assessment;
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
      where: {
        questionOrder: {
          [Op.contains]: { [assessmentId]: { [Op.ne]: null } }
        }
      },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId },
          attributes: ['id', 'name', 'code']
        },
        {
          model: Variants,
          as: 'variants',
          where: { assessmentId: assessmentId },
          attributes: ['id', 'questionText', 'difficulty', 'answer', 'choices']
        }
      ],
      order: [
        [sequelize.literal(`CAST(question_order->>'${assessmentId}' AS INTEGER)`), 'ASC']
      ]
    });

    return questions;
  } catch (error) {
    throw error;
  }
};
