/**
 * Assessment section service for manipulating sections, section-variant links, and validation helpers.
 * Ensures sections belong to the requesting user and keeps variant/assessment relationships consistent.
 */
import { prisma } from '../config/database.js';

/** Loads an assessment scoped to a user or throws if it is missing. */
const findAssessmentForUser = async (assessmentId, userId) => {
  const assessment = await prisma.assessments.findFirst({
    where: { id: assessmentId, course: { userId } },
  });

  if (!assessment) {
    throw new Error('Assessment not found');
  }

  return assessment;
};

/**
 * Fetches a section while verifying the parent assessment belongs to the user. When
 * `courseId` (the authorized course, e.g. req.qmCourse.id) is supplied, the section must
 * also live in that course — owner scoping alone lets a user reach a section in a
 * DIFFERENT course they own via a route authorized for another one (#1).
 */
const findSectionForUser = async (sectionId, userId, courseId = null) => {
  const section = await prisma.assessmentSections.findFirst({
    where: { id: sectionId, assessment: { course: { userId } } },
    include: {
      assessment: { select: { id: true, courseId: true } },
    },
  });

  if (!section) {
    throw new Error('Section not found');
  }

  if (courseId != null && section.assessment?.courseId !== courseId) {
    throw new Error('Section not found');
  }

  return section;
};

/** Returns all sections (with nested variants) for an assessment the user owns. */
export const getSectionsForAssessment = async (assessmentId, userId) => {
  assessmentId = Number(assessmentId);
  await findAssessmentForUser(assessmentId, userId);

  const sections = await prisma.assessmentSections.findMany({
    where: { assessmentId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    include: {
      sectionVariants: {
        orderBy: { displayOrder: 'asc' },
        include: {
          variant: {
            select: {
              id: true, questionText: true, difficulty: true, reasoningLevel: true,
              questionMetadataId: true, isAiGenerated: true, isDraft: true, answer: true, choices: true,
              questionMetadata: {
                select: {
                  id: true, description: true, type: true, questionOrder: true,
                  // Unenriched here (`Course` dropped name/code, #1072 §4 step 10).
                  course: { select: { id: true } }
                }
              }
            }
          }
        }
      }
    }
  });

  return sections;
};

/** Creates a new section for an assessment, defaulting to the next position slot. */
export const createAssessmentSection = async (assessmentId, userId, payload) => {
  assessmentId = Number(assessmentId);
  const assessment = await findAssessmentForUser(assessmentId, userId);

  const position = payload.position ?? await prisma.assessmentSections.count({ where: { assessmentId } });

  const section = await prisma.assessmentSections.create({
    data: {
      assessmentId: assessment.id,
      name: payload.name?.trim() || 'Section',
      description: payload.description?.trim() || null,
      sectionType: payload.sectionType || null,
      difficultySettings: payload.difficultySettings || null,
      topicFilters: payload.topicFilters || null,
      metadata: payload.metadata || null,
      position
    }
  });

  return section;
};

/** Updates section metadata/filters/position after verifying ownership and course scope. */
export const updateAssessmentSection = async (sectionId, userId, updates, courseId = null) => {
  sectionId = Number(sectionId);
  const section = await findSectionForUser(sectionId, userId, courseId);

  const updated = await prisma.assessmentSections.update({
    where: { id: section.id },
    data: {
      ...(updates.name !== undefined && { name: updates.name?.trim() || section.name }),
      ...(updates.description !== undefined && { description: updates.description?.trim() || null }),
      ...(updates.sectionType !== undefined && { sectionType: updates.sectionType }),
      ...(updates.difficultySettings !== undefined && { difficultySettings: updates.difficultySettings }),
      ...(updates.topicFilters !== undefined && { topicFilters: updates.topicFilters }),
      ...(updates.metadata !== undefined && { metadata: updates.metadata }),
      ...(updates.position !== undefined && { position: updates.position })
    }
  });

  return updated;
};

/** Deletes a section and clears variant assessment links if they are no longer referenced. */
export const deleteAssessmentSection = async (sectionId, userId, courseId = null) => {
  sectionId = Number(sectionId);
  const section = await findSectionForUser(sectionId, userId, courseId);
  const assessmentId = section.assessment.id;

  // Get all variants in this section
  const sectionVariants = await prisma.sectionVariants.findMany({
    where: { sectionId },
    select: { variantId: true }
  });

  const variantIds = sectionVariants.map(sv => sv.variantId);

  // Delete the section (this will cascade delete SectionVariants)
  await prisma.assessmentSections.delete({ where: { id: section.id } });

  if (variantIds.length === 0) return true;

  // Which of those variants are still placed in another section of the same assessment?
  // This runs after the delete above, so the cascaded rows are already gone and the
  // grouping only sees surviving links. groupBy omits empty groups, so a variant absent
  // from the result is exactly one whose remaining link count is zero.
  const stillLinked = await prisma.sectionVariants.groupBy({
    by: ['variantId'],
    where: { variantId: { in: variantIds }, section: { assessmentId } }
  });
  const linkedIds = new Set(stillLinked.map(row => row.variantId));
  const orphanedIds = variantIds.filter(id => !linkedIds.has(id));

  // Clear the assessment link on the orphans. The `assessmentId` predicate carries the
  // per-variant guard the old read performed, so no lookup is needed.
  if (orphanedIds.length > 0) {
    await prisma.variants.updateMany({
      where: { id: { in: orphanedIds }, assessmentId },
      data: { assessmentId: null }
    });
  }

  return true;
};

/**
 * Ensures a variant belongs to the requesting user before linking. When `courseId` (the
 * authorized course) is supplied, the variant must also belong to that course, so a
 * variant from another course the user owns can't be linked across courses (#1).
 */
const verifyVariantOwnership = async (variantId, userId, courseId = null) => {
  const variant = await prisma.variants.findFirst({
    where: { id: variantId, questionMetadata: { course: { userId } } },
    include: {
      questionMetadata: { select: { id: true, courseId: true } }
    }
  });

  if (!variant) {
    throw new Error('Variant not found');
  }

  if (courseId != null && variant.questionMetadata?.courseId !== courseId) {
    throw new Error('Variant not found');
  }

  return variant;
};

/** Adds a variant to a section, ensuring assessment linkage/order metadata stays in sync. */
export const addVariantToSection = async (sectionId, userId, variantId, options = {}, courseId = null) => {
  sectionId = Number(sectionId);
  variantId = Number(variantId);
  const section = await findSectionForUser(sectionId, userId, courseId);
  const variant = await verifyVariantOwnership(variantId, userId, courseId);

  const displayOrder = options.displayOrder ?? await prisma.sectionVariants.count({ where: { sectionId } });

  const link = await prisma.sectionVariants.create({
    data: {
      sectionId,
      variantId,
      displayOrder,
      metadata: options.metadata || null
    }
  });

  // Update the variant's assessmentId to link it to the assessment
  const assessmentId = section.assessment.id;
  if (variant.assessmentId !== assessmentId) {
    await prisma.variants.update({ where: { id: variant.id }, data: { assessmentId } });
  }

  return link;
};

/** Removes a variant from a section and clears assessment references if no other links remain. */
export const removeVariantFromSection = async (sectionId, userId, variantId, courseId = null) => {
  sectionId = Number(sectionId);
  variantId = Number(variantId);
  const section = await findSectionForUser(sectionId, userId, courseId);

  const { count: deleted } = await prisma.sectionVariants.deleteMany({
    where: { sectionId, variantId }
  });

  if (!deleted) {
    throw new Error('Variant not found in section');
  }

  // Check if variant is in any other sections of the same assessment
  const assessmentId = section.assessment.id;
  const otherSectionsCount = await prisma.sectionVariants.count({
    where: { variantId, section: { assessmentId } }
  });

  // If variant is not in any other sections of this assessment, clear the assessmentId
  if (otherSectionsCount === 0) {
    const variant = await prisma.variants.findUnique({ where: { id: variantId } });
    if (variant && variant.assessmentId === assessmentId) {
      await prisma.variants.update({ where: { id: variantId }, data: { assessmentId: null } });
    }
  }

  return true;
};

/** Updates the display order for a variant inside a section. */
export const updateVariantOrderInSection = async (sectionId, userId, variantId, displayOrder, courseId = null) => {
  sectionId = Number(sectionId);
  variantId = Number(variantId);
  await findSectionForUser(sectionId, userId, courseId);

  const link = await prisma.sectionVariants.findFirst({
    where: { sectionId, variantId }
  });

  if (!link) {
    throw new Error('Variant not found in section');
  }

  const updated = await prisma.sectionVariants.update({
    where: { id: link.id },
    data: { displayOrder }
  });

  return updated;
};

/** Reports whether a question’s variants are linked to any sections and which assessments would be impacted. */
export const checkQuestionInAssessments = async (questionId, userId) => {
  questionId = Number(questionId);
  // Verify user owns the question
  const question = await prisma.questionMetadata.findFirst({
    where: { id: questionId, course: { userId } }
  });

  if (!question) {
    throw new Error('Question not found');
  }

  // Find all variants of this question
  const variants = await prisma.variants.findMany({
    where: { questionMetadataId: questionId }
  });

  if (variants.length === 0) {
    return { isInAssessments: false, assessmentIds: [] };
  }

  const variantIds = variants.map((v) => v.id);

  // Find all section variant links for these variants
  const sectionVariantLinks = await prisma.sectionVariants.findMany({
    where: { variantId: { in: variantIds } },
    include: {
      section: {
        select: {
          id: true, assessmentId: true,
          assessment: { select: { id: true } }
        }
      }
    }
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
  questionId = Number(questionId);
  // Verify user owns the question
  const question = await prisma.questionMetadata.findFirst({
    where: { id: questionId, course: { userId } }
  });

  if (!question) {
    throw new Error('Question not found');
  }

  // Find all variants of this question
  const variants = await prisma.variants.findMany({
    where: { questionMetadataId: questionId }
  });

  if (variants.length === 0) {
    return { removedLinks: 0, affectedAssessments: [] };
  }

  const variantIds = variants.map((v) => v.id);

  // Find all section variant links for these variants
  const sectionVariantLinks = await prisma.sectionVariants.findMany({
    where: { variantId: { in: variantIds } },
    include: {
      section: {
        select: {
          id: true, assessmentId: true,
          assessment: { select: { id: true } }
        }
      }
    }
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
  const { count: deletedCount } = await prisma.sectionVariants.deleteMany({
    where: { variantId: { in: variantIds } }
  });

  // Update questionOrder for each affected assessment
  const currentOrder = question.questionOrder || {};
  affectedAssessmentIds.forEach((assessmentId) => {
    delete currentOrder[assessmentId];
  });
  await prisma.questionMetadata.update({
    where: { id: question.id },
    data: { questionOrder: currentOrder }
  });

  return {
    removedLinks: deletedCount,
    affectedAssessments: Array.from(affectedAssessmentIds)
  };
};
