/**
 * Assessment section service for manipulating sections, section-variant links, and validation helpers.
 * Ensures sections belong to the requesting user and keeps variant/assessment relationships consistent.
 */
import { Assessments, AssessmentSections, SectionVariants, Variants, Question_Metadata, Course } from '../schema/index.js';

/** Loads an assessment scoped to a user or throws if it is missing. */
const findAssessmentForUser = async (assessmentId, userId) => {
  const assessment = await Assessments.findOne({
    where: { id: assessmentId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id'],
        required: true
      }
    ]
  });

  if (!assessment) {
    throw new Error('Assessment not found');
  }

  return assessment;
};

/** Fetches a section while verifying the parent assessment belongs to the user. */
const findSectionForUser = async (sectionId, userId) => {
  const section = await AssessmentSections.findOne({
    where: { id: sectionId },
    include: [
      {
        model: Assessments,
        as: 'assessment',
        include: [
          {
            model: Course,
            as: 'course',
            where: { userId },
            attributes: ['id']
          }
        ]
      }
    ]
  });

  if (!section) {
    throw new Error('Section not found');
  }

  return section;
};

/** Returns all sections (with nested variants) for an assessment the user owns. */
export const getSectionsForAssessment = async (assessmentId, userId) => {
  await findAssessmentForUser(assessmentId, userId);

  const sections = await AssessmentSections.findAll({
    where: { assessmentId },
    order: [['position', 'ASC'], ['id', 'ASC']],
    include: [
      {
        model: SectionVariants,
        as: 'sectionVariants',
        order: [['displayOrder', 'ASC']],
        include: [
          {
            model: Variants,
            as: 'variant',
            attributes: ['id', 'questionText', 'difficulty', 'reasoningLevel', 'questionMetadataId', 'isAiGenerated', 'isDraft', 'answer', 'choices'],
            include: [
              {
                model: Question_Metadata,
                as: 'questionMetadata',
                attributes: ['id', 'description', 'type', 'questionOrder'],
                include: [
                  {
                    model: Course,
                    as: 'course',
                    attributes: ['id', 'name', 'code']
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  });

  return sections;
};

/** Creates a new section for an assessment, defaulting to the next position slot. */
export const createAssessmentSection = async (assessmentId, userId, payload) => {
  const assessment = await findAssessmentForUser(assessmentId, userId);

  const position = payload.position ?? await AssessmentSections.count({ where: { assessmentId } });

  const section = await AssessmentSections.create({
    assessmentId: assessment.id,
    name: payload.name?.trim() || 'Section',
    description: payload.description?.trim() || null,
    sectionType: payload.sectionType || null,
    difficultySettings: payload.difficultySettings || null,
    topicFilters: payload.topicFilters || null,
    metadata: payload.metadata || null,
    position
  });

  return section;
};

/** Updates section metadata/filters/position after verifying ownership. */
export const updateAssessmentSection = async (sectionId, userId, updates) => {
  const section = await findSectionForUser(sectionId, userId);

  await section.update({
    ...(updates.name !== undefined && { name: updates.name?.trim() || section.name }),
    ...(updates.description !== undefined && { description: updates.description?.trim() || null }),
    ...(updates.sectionType !== undefined && { sectionType: updates.sectionType }),
    ...(updates.difficultySettings !== undefined && { difficultySettings: updates.difficultySettings }),
    ...(updates.topicFilters !== undefined && { topicFilters: updates.topicFilters }),
    ...(updates.metadata !== undefined && { metadata: updates.metadata }),
    ...(updates.position !== undefined && { position: updates.position })
  });

  return section;
};

/** Deletes a section and clears variant assessment links if they are no longer referenced. */
export const deleteAssessmentSection = async (sectionId, userId) => {
  const section = await findSectionForUser(sectionId, userId);
  const assessmentId = section.assessment.id;

  // Get all variants in this section
  const sectionVariants = await SectionVariants.findAll({
    where: { sectionId },
    attributes: ['variantId']
  });

  const variantIds = sectionVariants.map(sv => sv.variantId);

  // Delete the section (this will cascade delete SectionVariants)
  await section.destroy();

  // For each variant, check if it's still in any other sections of the same assessment
  for (const variantId of variantIds) {
    const otherSectionsCount = await SectionVariants.count({
      where: { variantId },
      include: [
        {
          model: AssessmentSections,
          as: 'section',
          where: { assessmentId },
          attributes: []
        }
      ]
    });

    // If variant is not in any other sections of this assessment, clear the assessmentId
    if (otherSectionsCount === 0) {
      const variant = await Variants.findByPk(variantId);
      if (variant && variant.assessmentId === assessmentId) {
        await variant.update({ assessmentId: null });
      }
    }
  }

  return true;
};

/** Ensures a variant belongs to the requesting user before linking. */
const verifyVariantOwnership = async (variantId, userId) => {
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
            where: { userId },
            attributes: ['id']
          }
        ]
      }
    ]
  });

  if (!variant) {
    throw new Error('Variant not found');
  }

  return variant;
};

/** Adds a variant to a section, ensuring assessment linkage/order metadata stays in sync. */
export const addVariantToSection = async (sectionId, userId, variantId, options = {}) => {
  const section = await findSectionForUser(sectionId, userId);
  const variant = await verifyVariantOwnership(variantId, userId);

  const displayOrder = options.displayOrder ?? await SectionVariants.count({ where: { sectionId } });

  const link = await SectionVariants.create({
    sectionId,
    variantId,
    displayOrder,
    metadata: options.metadata || null
  });

  // Update the variant's assessmentId to link it to the assessment
  const assessmentId = section.assessment.id;
  if (variant.assessmentId !== assessmentId) {
    await variant.update({ assessmentId });
  }

  return link;
};

/** Removes a variant from a section and clears assessment references if no other links remain. */
export const removeVariantFromSection = async (sectionId, userId, variantId) => {
  const section = await findSectionForUser(sectionId, userId);

  const deleted = await SectionVariants.destroy({
    where: { sectionId, variantId }
  });

  if (!deleted) {
    throw new Error('Variant not found in section');
  }

  // Check if variant is in any other sections of the same assessment
  const assessmentId = section.assessment.id;
  const otherSectionsCount = await SectionVariants.count({
    where: { variantId },
    include: [
      {
        model: AssessmentSections,
        as: 'section',
        where: { assessmentId },
        attributes: []
      }
    ]
  });

  // If variant is not in any other sections of this assessment, clear the assessmentId
  if (otherSectionsCount === 0) {
    const variant = await Variants.findByPk(variantId);
    if (variant && variant.assessmentId === assessmentId) {
      await variant.update({ assessmentId: null });
    }
  }

  return true;
};

/** Updates the display order for a variant inside a section. */
export const updateVariantOrderInSection = async (sectionId, userId, variantId, displayOrder) => {
  await findSectionForUser(sectionId, userId);

  const link = await SectionVariants.findOne({
    where: { sectionId, variantId }
  });

  if (!link) {
    throw new Error('Variant not found in section');
  }

  link.displayOrder = displayOrder;
  await link.save();

  return link;
};

/** Reports whether a question’s variants are linked to any sections and which assessments would be impacted. */
export const checkQuestionInAssessments = async (questionId, userId) => {
  // Verify user owns the question
  const question = await Question_Metadata.findOne({
    where: { id: questionId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id']
      }
    ]
  });

  if (!question) {
    throw new Error('Question not found');
  }

  // Find all variants of this question
  const variants = await Variants.findAll({
    where: { questionMetadataId: questionId }
  });

  if (variants.length === 0) {
    return { isInAssessments: false, assessmentIds: [] };
  }

  const variantIds = variants.map((v) => v.id);

  // Find all section variant links for these variants
  const sectionVariantLinks = await SectionVariants.findAll({
    where: { variantId: variantIds },
    include: [
      {
        model: AssessmentSections,
        as: 'section',
        attributes: ['id', 'assessmentId'],
        include: [
          {
            model: Assessments,
            as: 'assessment',
            attributes: ['id']
          }
        ]
      }
    ]
  });

  if (sectionVariantLinks.length === 0) {
    return { isInAssessments: false, assessmentIds: [] };
  }

  // Get unique assessment IDs
  const assessmentIds = new Set();
  sectionVariantLinks.forEach((link) => {
    if (link.section?.assessment?.id) {
      assessmentIds.add(link.section.assessment.id);
    }
  });

  return {
    isInAssessments: assessmentIds.size > 0,
    assessmentIds: Array.from(assessmentIds)
  };
};

/** Removes every section link for a question’s variants and clears their order metadata. */
export const removeQuestionFromAllSections = async (questionId, userId) => {
  // Verify user owns the question
  const question = await Question_Metadata.findOne({
    where: { id: questionId },
    include: [
      {
        model: Course,
        as: 'course',
        where: { userId },
        attributes: ['id']
      }
    ]
  });

  if (!question) {
    throw new Error('Question not found');
  }

  // Find all variants of this question
  const variants = await Variants.findAll({
    where: { questionMetadataId: questionId }
  });

  if (variants.length === 0) {
    return { removedLinks: 0, affectedAssessments: [] };
  }

  const variantIds = variants.map((v) => v.id);

  // Find all section variant links for these variants
  const sectionVariantLinks = await SectionVariants.findAll({
    where: { variantId: variantIds },
    include: [
      {
        model: AssessmentSections,
        as: 'section',
        attributes: ['id', 'assessmentId'],
        include: [
          {
            model: Assessments,
            as: 'assessment',
            attributes: ['id']
          }
        ]
      }
    ]
  });

  if (sectionVariantLinks.length === 0) {
    return { removedLinks: 0, affectedAssessments: [] };
  }

  // Get unique assessment IDs
  const affectedAssessmentIds = new Set();
  sectionVariantLinks.forEach((link) => {
    if (link.section?.assessment?.id) {
      affectedAssessmentIds.add(link.section.assessment.id);
    }
  });

  // Delete all section variant links
  const deletedCount = await SectionVariants.destroy({
    where: { variantId: variantIds }
  });

  // Update questionOrder for each affected assessment
  const currentOrder = question.questionOrder || {};
  affectedAssessmentIds.forEach((assessmentId) => {
    delete currentOrder[assessmentId];
  });
  await question.update({ questionOrder: currentOrder });

  return {
    removedLinks: deletedCount,
    affectedAssessments: Array.from(affectedAssessmentIds)
  };
};
