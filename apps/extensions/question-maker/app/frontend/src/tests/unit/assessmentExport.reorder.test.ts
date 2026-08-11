import { describe, expect, it } from 'vitest';
import { collectAssessmentExportBlocks } from '@/utils/assessmentExport';
import type { Assessment, AssessmentSection, QuestionVariant, SectionVariantLink } from '@/types/question';

function variant(id: number, stem: string): QuestionVariant {
  return {
    id,
    questionText: stem,
    questionMetadataId: id,
    createdAt: '',
    updatedAt: '',
  };
}

function link(
  id: number,
  sectionId: number,
  variantId: number,
  displayOrder: number,
  v: QuestionVariant,
): SectionVariantLink {
  return { id, sectionId, variantId, displayOrder, variant: v };
}

function section(
  id: number,
  position: number,
  links: SectionVariantLink[],
): AssessmentSection {
  return {
    id,
    assessmentId: 1,
    name: `Section ${id}`,
    position,
    createdAt: '',
    updatedAt: '',
    sectionVariants: links,
  };
}

describe('collectAssessmentExportBlocks section ordering', () => {
  it('walks sections by position then links by displayOrder', () => {
    const v1 = variant(1, 'Q1');
    const v2 = variant(2, 'Q2');
    const v3 = variant(3, 'Q3');

    const assessment: Assessment = {
      id: 1,
      type: 'midterm',
      name: 'Test',
      semester: '2026W1',
      createdAt: '',
      updatedAt: '',
      // API payload order differs from position — export must follow position
      sections: [
        section(2, 1, [link(20, 2, 2, 0, v2)]),
        section(1, 0, [
          link(10, 1, 3, 0, v3),
          link(11, 1, 1, 0, v1),
        ]),
      ],
    };

    const blocks = collectAssessmentExportBlocks(assessment);
    expect(blocks.map((b) => b.stem)).toEqual(['Q3', 'Q1', 'Q2']);
  });
});
