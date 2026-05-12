/**
 * Helpers for loading ordered variants and aggregating slot structure for the assessment variant workflow.
 */
import {
  AssessmentSections,
  SectionVariants,
  Variants,
  Question_Metadata
} from '../schema/index.js';

/** Loads ordered variant rows for an assessment (all sections, section position then display order). */
export async function loadOrderedVariantsForAssessment(assessmentId) {
  const sections = await AssessmentSections.findAll({
    where: { assessmentId },
    order: [['position', 'ASC'], ['id', 'ASC']],
    include: [
      {
        model: SectionVariants,
        as: 'sectionVariants',
        separate: true,
        order: [['displayOrder', 'ASC'], ['id', 'ASC']],
        include: [
          {
            model: Variants,
            as: 'variant',
            attributes: [
              'id',
              'questionText',
              'answer',
              'choices',
              'difficulty',
              'reasoningLevel',
              'questionMetadataId',
              'isAiGenerated',
              'isDraft'
            ],
            include: [
              {
                model: Question_Metadata,
                as: 'questionMetadata',
                attributes: ['id', 'type', 'primaryTopicId', 'description']
              }
            ]
          }
        ]
      }
    ]
  });

  const ordered = [];
  for (const section of sections) {
    const links = section.sectionVariants || [];
    for (const link of links) {
      if (link.variant) ordered.push(link.variant);
    }
  }
  return ordered;
}

/** Aggregates topic / difficulty / type counts from variant rows (topic keys are strings). */
export function aggregateStructure(variants, topicKeyFn = (v) => v.questionMetadata?.primaryTopicId) {
  const topicCounts = {};
  const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
  const typeCounts = { MCQ: 0, SA: 0, LA: 0 };
  const baseQuestionIds = [];

  for (const v of variants) {
    const meta = v.questionMetadata;
    if (!meta) continue;
    const tid = topicKeyFn(v);
    if (tid != null) {
      const key = String(tid);
      topicCounts[key] = (topicCounts[key] ?? 0) + 1;
    }
    if (difficultyCounts[v.difficulty] !== undefined) {
      difficultyCounts[v.difficulty] += 1;
    }
    if (typeCounts[meta.type] !== undefined) {
      typeCounts[meta.type] += 1;
    }
    baseQuestionIds.push(meta.id);
  }

  return { topicCounts, difficultyCounts, typeCounts, baseQuestionIds, n: variants.length };
}
