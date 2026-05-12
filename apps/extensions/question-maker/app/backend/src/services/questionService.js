/**
 * Question service providing CRUD for metadata/variants plus assessment ordering helpers.
 * Validates ownership via course relationships and keeps variant-topic links normalized.
 */
import { Question_Metadata, Variants, Topics, Assessments, AssessmentSections, SectionVariants } from '../schema/index.js';
import { Course } from '../schema/Course.js';

/** Normalizes any acceptable topic input (array/string/number) into an array of integers. */
const normalizeSecondaryTopics = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item));
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? [value] : [];
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item));
  }

  return [];
};

/**
 * Validates and normalizes MCQ choices array.
 * Returns normalized choices array or null if invalid.
 */
const validateMCQChoices = (choices, questionType) => {
  // Only validate for MCQ questions
  if (questionType !== 'MCQ') {
    return null;
  }

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const normalized = choices
    .map((choice) => {
      if (typeof choice === 'object' && choice !== null) {
        const letter = typeof choice.letter === 'string' 
          ? choice.letter.toUpperCase().trim() 
          : null;
        const text = typeof choice.text === 'string' 
          ? choice.text.trim() 
          : '';
        
        if (letter && text && /^[A-Z]$/.test(letter)) {
          return { letter, text };
        }
      }
      return null;
    })
    .filter((choice) => choice !== null);

  // Ensure at least 2 choices and unique letters
  if (normalized.length < 2) {
    return null;
  }

  const seenLetters = new Set();
  const uniqueChoices = normalized.filter((choice) => {
    if (seenLetters.has(choice.letter)) {
      return false;
    }
    seenLetters.add(choice.letter);
    return true;
  });

  return uniqueChoices.length >= 2 ? uniqueChoices : null;
};

/**
 * Extracts just the letter from answer text for MCQ questions.
 * Handles formats like: "B", "B)", "B) Option B", etc.
 */
const extractAnswerLetter = (answer) => {
  if (!answer || typeof answer !== 'string') {
    return null;
  }

  const trimmed = answer.trim();
  const match = trimmed.match(/^([A-Za-z])/);
  return match ? match[1].toUpperCase() : trimmed;
};

/** Builds a short question description from available text fields so metadata looks tidy. */
const generateMetadataDescription = (questionText, summary, instructions) => {
  const candidate = [summary, instructions, questionText].find(
    (value) => typeof value === 'string' && value.trim().length > 0
  );

  if (!candidate) {
    return 'Question';
  }

  const normalized = candidate.replace(/\s+/g, ' ').trim();
  const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
  const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
  const words = base.split(' ');

  if (words.length <= 12) {
    return base;
  }

  return `${words.slice(0, 12).join(' ')}…`;
};

/** Creates question metadata after validating ownership, type, and topic IDs. */
export const createQuestion = async (userId, questionData) => {
  try {
    const {
      description,
      courseId,
      primaryTopicId,
      type = 'MCQ',
      questionOrder = {}
    } = questionData;

    const normalizedDescription = typeof description === 'string' && description.trim()
      ? description.trim()
      : null;

    const parsedCourseId = Number(courseId);
    if (!Number.isInteger(parsedCourseId)) {
      throw new Error('Valid courseId is required');
    }

    const parsedPrimaryTopicId = Number(primaryTopicId);
    if (!Number.isInteger(parsedPrimaryTopicId)) {
      throw new Error('Valid primaryTopicId is required');
    }

    const course = await Course.findOne({
      where: { id: parsedCourseId, userId },
      attributes: ['id']
    });

    if (!course) {
      throw new Error('Course not found');
    }

    const allowedTypes = ['MCQ', 'SA', 'LA'];
    const normalizedType = allowedTypes.includes(type) ? type : 'MCQ';

    const question = await Question_Metadata.create({
      courseId: parsedCourseId,
      primaryTopicId: parsedPrimaryTopicId,
      type: normalizedType,
      description: normalizedDescription,
      questionOrder: questionOrder && typeof questionOrder === 'object' ? questionOrder : {}
    });

    return question;
  } catch (error) {
    throw error;
  }
};

/** Returns questions (with course + variant associations) scoped to the requesting user. */
export const getQuestionsByUser = async (userId, options = {}) => {
  try {
    const { courseId, search, limit = 50, offset = 0 } = options;
    
    // Build where clause for Question_Metadata
    const whereClause = {};
    
    if (courseId) {
      const parsedCourseId = Number(courseId);
      if (Number.isInteger(parsedCourseId)) {
        whereClause.courseId = parsedCourseId;
      }
    }

    const questions = await Question_Metadata.findAll({
      where: whereClause,
      include: [
        {
          model: Course,
          as: 'course',
          attributes: ['id', 'name', 'code'],
          where: { userId: userId } // Filter by user through course relationship
        },
        {
          model: Variants,
          as: 'variants',
          attributes: ['id', 'questionText', 'difficulty', 'reasoningLevel', 'answer', 'choices', 'assessmentId', 'secondaryTopicsId', 'referenceId', 'isAiGenerated', 'isDraft', 'createdAt', 'updatedAt'],
          include: [
            {
              model: Assessments,
              as: 'assessment',
              attributes: ['id', 'name', 'type', 'semester']
            }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Apply search filter if provided
    let filteredQuestions = questions;
    if (search) {
      filteredQuestions = questions.filter(q => 
        q.description.toLowerCase().includes(search.toLowerCase())
      );
    }

    return filteredQuestions;
  } catch (error) {
    throw error;
  }
};

/** Fetches a single question with variants once the user-course relationship is confirmed. */
export const getQuestionById = async (questionId, userId) => {
  try {
    const question = await Question_Metadata.findOne({
      where: { id: questionId },
      include: [
        {
          model: Course,
          as: 'course',
          attributes: ['id', 'name', 'code'],
          where: { userId: userId } // Ensure user owns the course
        },
        {
          model: Variants,
          as: 'variants',
          attributes: ['id', 'questionText', 'difficulty', 'reasoningLevel', 'answer', 'choices', 'assessmentId', 'secondaryTopicsId', 'referenceId', 'isAiGenerated', 'isDraft', 'createdAt', 'updatedAt'],
          include: [
            {
              model: Assessments,
              as: 'assessment',
              attributes: ['id', 'name', 'type', 'semester']
            }
          ]
        }
      ]
    });

    if (!question) {
      throw new Error('Question not found');
    }

    return question;
  } catch (error) {
    throw error;
  }
};

/** Updates metadata fields while ensuring provided IDs and types remain valid. */
export const updateQuestion = async (questionId, userId, updateData) => {
  try {
    const question = await Question_Metadata.findOne({
      where: { id: questionId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId } // Ensure user owns the course
        }
      ]
    });

    if (!question) {
      throw new Error('Question not found');
    }

    const updates = { ...updateData };

    if (updates.description !== undefined) {
      const desc = updates.description;
      updates.description = typeof desc === 'string' && desc.trim()
        ? desc.trim()
        : null;
    }

    if (updates.courseId !== undefined) {
      const parsedCourseId = Number(updates.courseId);
      if (!Number.isInteger(parsedCourseId)) {
        throw new Error('Valid courseId is required');
      }

      const course = await Course.findOne({
        where: { id: parsedCourseId, userId },
        attributes: ['id']
      });

      if (!course) {
        throw new Error('Course not found');
      }

      updates.courseId = parsedCourseId;
    }

    if (updates.primaryTopicId !== undefined) {
      const parsedPrimaryTopicId = Number(updates.primaryTopicId);
      if (!Number.isInteger(parsedPrimaryTopicId)) {
        throw new Error('Valid primaryTopicId is required');
      }
      updates.primaryTopicId = parsedPrimaryTopicId;
    }

    if (updates.type !== undefined) {
      const allowedTypes = ['MCQ', 'SA', 'LA'];
      if (!allowedTypes.includes(updates.type)) {
        throw new Error(`Invalid question type. Allowed values: ${allowedTypes.join(', ')}`);
      }
    }

    if (updates.questionOrder !== undefined && typeof updates.questionOrder !== 'object') {
      throw new Error('questionOrder must be an object');
    }

    // isAiGenerated and isDraft are variant-level fields and should not be updated via updateQuestion
    // They should be updated via updateVariant instead
    if (updates.isAiGenerated !== undefined || updates.isDraft !== undefined) {
      throw new Error('isAiGenerated and isDraft are variant-level fields. Use updateVariant to update individual variants.');
    }

    await question.update(updates);
    return question;
  } catch (error) {
    throw error;
  }
};

/** Deletes a question (and cascades variants) after verifying the user owns the course. */
export const deleteQuestion = async (questionId, userId) => {
  try {
    const question = await Question_Metadata.findOne({
      where: { id: questionId },
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId } // Ensure user owns the course
        }
      ]
    });

    if (!question) {
      throw new Error('Question not found');
    }

    await question.destroy();
    return true;
  } catch (error) {
    throw error;
  }
};

/** Bulk-creates multiple questions for approvals, short-circuiting on validation issues. */
export const createMultipleQuestions = async (userId, questionsData) => {
  try {
    const createdQuestions = [];

    for (const q of questionsData) {
      const rawDesc = q.description ?? q.content;
      const description = typeof rawDesc === 'string' && rawDesc.trim() ? rawDesc.trim() : null;
      const courseId = Number(q.courseId ?? q.classId);
      const primaryTopicId = Number(q.primaryTopicId ?? 1);
      const type = ['MCQ', 'SA', 'LA'].includes(q.type) ? q.type : 'MCQ';
      const questionOrder = q.questionOrder || {};

      const question = await createQuestion(userId, {
        description,
        courseId,
        primaryTopicId,
        type,
        questionOrder
      });

      createdQuestions.push(question);
    }

    return createdQuestions;
  } catch (error) {
    throw error;
  }
};

/** Persists extracted questions/variants and optionally creates assessments/sections for them. */
export const saveExtractedQuestions = async (userId, payload) => {
  const { courseId, primaryTopicId, topicName, questions, assessment, isAiGenerated = false } = payload;

  if (!courseId) {
    throw new Error('courseId is required');
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Questions array is required');
  }

  const course = await Course.findOne({
    where: { id: Number(courseId), userId },
    attributes: ['id']
  });

  if (!course) {
    throw new Error('Course not found');
  }

  const transaction = await Question_Metadata.sequelize.transaction();

  try {
    const existingTopics = await Topics.findAll({
      where: { courseId },
      transaction
    });
    const topicIdSet = new Set(existingTopics.map((topic) => topic.id));

    let fallbackTopicId = primaryTopicId ? Number(primaryTopicId) : null;
    if (fallbackTopicId && !topicIdSet.has(fallbackTopicId)) {
      const fallbackTopic = await Topics.findOne({
        where: { id: fallbackTopicId, courseId },
        transaction
      });

      if (!fallbackTopic) {
        throw new Error('Primary topic not found for this course');
      }

      topicIdSet.add(fallbackTopicId);
    }

    const sanitizedTopicName = topicName ? topicName.trim() : '';

    const ensureFallbackTopic = async () => {
      if (fallbackTopicId && topicIdSet.has(fallbackTopicId)) {
        return fallbackTopicId;
      }

      if (sanitizedTopicName) {
        let topic = await Topics.findOne({
          where: { name: sanitizedTopicName, courseId },
          transaction
        });

        if (!topic) {
          topic = await Topics.create({
            name: sanitizedTopicName,
            courseId
          }, { transaction });
        }

        topicIdSet.add(topic.id);
        fallbackTopicId = topic.id;
        return fallbackTopicId;
      }

      if (topicIdSet.size === 0) {
        const autoTopic = await Topics.create({
          name: 'Uploaded Questions',
          courseId
        }, { transaction });
        topicIdSet.add(autoTopic.id);
        fallbackTopicId = autoTopic.id;
        return fallbackTopicId;
      }

      const firstTopic = existingTopics[0];
      fallbackTopicId = firstTopic ? firstTopic.id : null;
      return fallbackTopicId;
    };

    let createdAssessment = null;
    let createdSection = null;
    if (assessment) {
      const { type, name, semester } = assessment;
      if (!type || !name || !semester) {
        throw new Error('Assessment type, name, and semester are required.');
      }
      createdAssessment = await Assessments.create({
        type,
        name,
        semester,
        courseId
      }, { transaction });

      // Create a default section for the uploaded questions
      createdSection = await AssessmentSections.create({
        assessmentId: createdAssessment.id,
        name: 'Uploaded Questions',
        description: 'Questions extracted from uploaded document',
        position: 0
      }, { transaction });
    }

    const createdIds = [];
    let orderCounter = 1;

    for (const item of questions) {
      const questionText = typeof item.question === 'string' ? item.question.trim() : '';
      if (!questionText) {
        continue;
      }

      const difficulty = typeof item.difficulty === 'string'
        ? item.difficulty.toLowerCase().trim()
        : '';

      const questionType = typeof item.type === 'string' && ['MCQ', 'SA', 'LA'].includes(item.type)
        ? item.type
        : 'SA';

      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      if (!summary) {
        throw new Error('Each question must include an AI-generated summary.');
      }

      const summaryText = generateMetadataDescription(
        questionText,
        summary,
        item.instructions
      );

      let primaryTopicForQuestion = null;
      if (item.primaryTopicId !== undefined && item.primaryTopicId !== null) {
        const candidate = Number(item.primaryTopicId);
        if (Number.isInteger(candidate) && topicIdSet.has(candidate)) {
          primaryTopicForQuestion = candidate;
        }
      }

      if (!primaryTopicForQuestion) {
        const fallback = await ensureFallbackTopic();
        if (!fallback) {
          throw new Error('Unable to determine primary topic for question.');
        }
        primaryTopicForQuestion = fallback;
      }

      const secondaryTopics = normalizeSecondaryTopics(item.secondaryTopicIds)
        .filter((id) => topicIdSet.has(id) && id !== primaryTopicForQuestion);

      const metadata = await Question_Metadata.create({
        description: summaryText,
        courseId,
        primaryTopicId: primaryTopicForQuestion,
        type: questionType,
        questionOrder: createdAssessment ? { [createdAssessment.id]: orderCounter } : {}
      }, { transaction });

      // Handle choices for MCQ questions
      let choices = null;
      let answer = item.answer;
      
      if (questionType === 'MCQ') {
        // Validate choices if provided
        if (item.choices) {
          choices = validateMCQChoices(item.choices, questionType);
        }
        
        // Normalize answer to just letter for MCQ
        if (typeof answer === 'string' && answer.trim()) {
          answer = extractAnswerLetter(answer) || answer.trim();
        }
      } else if (typeof answer === 'string' && answer.trim()) {
        answer = answer.trim();
      } else {
        answer = null;
      }

      const variant = await Variants.create({
        questionMetadataId: metadata.id,
        questionText,
        difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
        answer,
        choices,
        assessmentId: createdAssessment ? createdAssessment.id : null,
        secondaryTopicsId: secondaryTopics,
        referenceId: null,
        isAiGenerated: Boolean(isAiGenerated),
        isDraft: true // All new variants start as drafts
      }, { transaction });

      // Link variant to section if assessment and section were created
      if (createdSection) {
        await SectionVariants.create({
          sectionId: createdSection.id,
          variantId: variant.id,
          displayOrder: orderCounter - 1
        }, { transaction });
      }

      createdIds.push(metadata.id);
      if (createdAssessment) {
        orderCounter += 1;
      }
    }

    if (createdIds.length === 0) {
      await transaction.rollback();
      throw new Error('No valid questions to save.');
    }

    await transaction.commit();

    const savedQuestions = await Question_Metadata.findAll({
      where: { id: createdIds },
      include: [
        {
          model: Course,
          as: 'course',
          attributes: ['id', 'name', 'code'],
          where: { userId }
        },
        {
          model: Variants,
          as: 'variants'
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return {
      questions: savedQuestions.map((question) => question.toJSON()),
      assessmentId: createdAssessment ? createdAssessment.id : null
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/** Aggregates counts of questions/variants/drafts for dashboard stats. */
export const getQuestionStats = async (userId) => {
  try {
    // Count questions for this user through course relationship
    const totalQuestions = await Question_Metadata.count({
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId }
        }
      ]
    });
    
    const typeStats = await Question_Metadata.findAll({
      attributes: [
        'type',
        [Question_Metadata.sequelize.fn('COUNT', Question_Metadata.sequelize.col('id')), 'count']
      ],
      include: [
        {
          model: Course,
          as: 'course',
          where: { userId: userId }
        }
      ],
      group: ['type']
    });

    return {
      totalQuestions,
      typeStats
    };
  } catch (error) {
    throw error;
  }
};

/** Updates the per-assessment ordering map stored on a question metadata row. */
export const updateQuestionOrder = async (questionId, assessmentId, orderNumber, userId) => {
  try {
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

    // Get current questionOrder or initialize empty object
    const currentOrder = question.questionOrder || {};
    
    // Update the order for the specific assessment
    currentOrder[assessmentId] = orderNumber;
    
    // Update the question with new order
    await question.update({ questionOrder: currentOrder });
    
    return question;
  } catch (error) {
    throw error;
  }
};

/** Removes a question from a specific assessment’s order map and detaches variants if needed. */
export const removeQuestionFromAssessment = async (questionId, assessmentId, userId) => {
  try {
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

    // Get current questionOrder or initialize empty object
    const currentOrder = question.questionOrder || {};
    
    // Remove the assessment from the order
    delete currentOrder[assessmentId];
    
    // Update the question with new order
    await question.update({ questionOrder: currentOrder });
    
    return question;
  } catch (error) {
    throw error;
  }
};

// Variant Management Functions
/** Creates a variant for a question while validating course ownership and metadata. */
export const createVariant = async (questionId, variantData, userId) => {
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

    const secondaryTopics = normalizeSecondaryTopics(variantData.secondaryTopicsId);
    const validReasoningLevels = ['factual', 'analytical', 'application'];
    const reasoningLevel = variantData.reasoningLevel && validReasoningLevels.includes(variantData.reasoningLevel)
      ? variantData.reasoningLevel
      : 'factual';

    // Handle choices for MCQ questions
    let choices = null;
    let answer = variantData.answer;
    
    if (question.type === 'MCQ') {
      if (variantData.choices !== undefined) {
        choices = validateMCQChoices(variantData.choices, question.type);
        // If choices are provided but invalid, throw error
        if (variantData.choices !== null && choices === null) {
          throw new Error('Invalid choices format for MCQ. Choices must be an array of objects with letter and text properties.');
        }
      }
      
      // Normalize answer to just letter for MCQ
      if (typeof answer === 'string' && answer.trim()) {
        answer = extractAnswerLetter(answer) || answer.trim();
      }
    } else if (typeof answer === 'string' && answer.trim()) {
      answer = answer.trim();
    } else {
      answer = null;
    }

    const variant = await Variants.create({
      questionMetadataId: questionId,
      questionText: variantData.questionText,
      difficulty: variantData.difficulty || 'medium',
      reasoningLevel,
      assessmentId: variantData.assessmentId || null,
      secondaryTopicsId: secondaryTopics,
      answer,
      choices,
      referenceId: variantData.referenceId || null,
      isAiGenerated: variantData.isAiGenerated !== undefined ? Boolean(variantData.isAiGenerated) : false,
      isDraft: variantData.isDraft !== undefined ? Boolean(variantData.isDraft) : true
    });

    return variant;
  } catch (error) {
    throw error;
  }
};

/** Updates a variant’s content/difficulty/associations, normalizing secondary topics. */
export const updateVariant = async (variantId, variantData, userId) => {
  try {
    const variant = await Variants.findOne({
      where: { id: variantId },
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
    });

    if (!variant) {
      throw new Error('Variant not found');
    }

    // Handle choices and answer normalization for MCQ
    let normalizedChoices = variantData.choices;
    let normalizedAnswer = variantData.answer;
    
    if (variant.questionMetadata && variant.questionMetadata.type === 'MCQ') {
      if (variantData.choices !== undefined) {
        normalizedChoices = validateMCQChoices(variantData.choices, 'MCQ');
        // If choices are provided but invalid, throw error
        if (variantData.choices !== null && normalizedChoices === null) {
          throw new Error('Invalid choices format for MCQ. Choices must be an array of objects with letter and text properties.');
        }
      }
      
      // Normalize answer to just letter for MCQ
      if (variantData.answer !== undefined && typeof variantData.answer === 'string' && variantData.answer.trim()) {
        normalizedAnswer = extractAnswerLetter(variantData.answer) || variantData.answer.trim();
      }
    } else if (variantData.answer !== undefined && typeof variantData.answer === 'string' && variantData.answer.trim()) {
      normalizedAnswer = variantData.answer.trim();
    }

    const normalizedData = {
      ...variantData,
      ...(variantData.secondaryTopicsId !== undefined && {
        secondaryTopicsId: normalizeSecondaryTopics(variantData.secondaryTopicsId)
      }),
      ...(variantData.isAiGenerated !== undefined && {
        isAiGenerated: Boolean(variantData.isAiGenerated)
      }),
      ...(variantData.isDraft !== undefined && {
        isDraft: Boolean(variantData.isDraft)
      }),
      ...(normalizedChoices !== undefined && {
        choices: normalizedChoices
      }),
      ...(normalizedAnswer !== undefined && {
        answer: normalizedAnswer
      })
    };

    await variant.update(normalizedData);
    return variant;
  } catch (error) {
    throw error;
  }
};

/** Deletes a variant and cleans up related section links if the user owns the question. */
export const deleteVariant = async (variantId, userId) => {
  try {
    const variant = await Variants.findOne({
      where: { id: variantId },
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
    });

    if (!variant) {
      throw new Error('Variant not found');
    }

    await variant.destroy();
    return true;
  } catch (error) {
    throw error;
  }
};

/** Lists all variants for a question, including assessment context, for the owning user. */
export const getVariantsByQuestion = async (questionId, userId) => {
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

    const variants = await Variants.findAll({
      where: { questionMetadataId: questionId },
      order: [['createdAt', 'ASC']]
    });

    return variants;
  } catch (error) {
    throw error;
  }
};
