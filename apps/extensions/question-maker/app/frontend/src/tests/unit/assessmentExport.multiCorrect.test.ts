import { describe, it, expect } from 'vitest';
import {
  collectAssessmentExportBlocks,
  assessmentBlocksToPlainText,
} from '@/utils/assessmentExport';
import type { Assessment, QuestionVariant } from '@/types/question';

function makeAssessment(variants: QuestionVariant[]): Assessment {
  return {
    id: 1,
    type: 'Quiz',
    name: 'Multi-correct quiz',
    semester: '2026W1',
    createdAt: '',
    updatedAt: '',
    sections: [
      {
        id: 10,
        assessmentId: 1,
        name: 'Section 1',
        position: 0,
        createdAt: '',
        updatedAt: '',
        sectionVariants: variants.map((variant, i) => ({
          id: 100 + i,
          sectionId: 10,
          variantId: variant.id,
          displayOrder: i + 1,
          variant,
        })),
      },
    ],
  };
}

const baseVariant = {
  difficulty: 'medium' as const,
  assessmentId: null,
  secondaryTopicsId: null,
  referenceId: null,
};

describe('assessmentExport multi-correct MCQ', () => {
  it('uses plural Correct answers when selectAllThatApply + correctAnswers', () => {
    const assessment = makeAssessment([
      {
        ...baseVariant,
        id: 1,
        questionText: 'Which are primes?',
        answer: 'A',
        choices: [
          { letter: 'A', text: '2' },
          { letter: 'B', text: '4' },
          { letter: 'C', text: '3' },
        ],
        selectAllThatApply: true,
        correctAnswers: ['A', 'C'],
      },
    ]);

    const blocks = collectAssessmentExportBlocks(assessment);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].answerLine).toBe('Correct answers: A, C');

    const text = assessmentBlocksToPlainText(blocks);
    expect(text).toContain('Correct answers: A, C');
    expect(text).not.toContain('Correct answer: A');
  });

  it('keeps singular Correct answer for single-key MCQ', () => {
    const assessment = makeAssessment([
      {
        ...baseVariant,
        id: 2,
        questionText: 'Capital of France?',
        answer: 'B',
        choices: [
          { letter: 'A', text: 'London' },
          { letter: 'B', text: 'Paris' },
        ],
        selectAllThatApply: false,
        correctAnswers: null,
      },
    ]);

    const blocks = collectAssessmentExportBlocks(assessment);
    expect(blocks[0].answerLine).toBe('Correct answer: B');
  });

  it('falls back to singular when select-all is set but correctAnswers empty', () => {
    const assessment = makeAssessment([
      {
        ...baseVariant,
        id: 3,
        questionText: 'Legacy multi with only answer letter',
        answer: 'A',
        choices: [
          { letter: 'A', text: 'One' },
          { letter: 'B', text: 'Two' },
        ],
        selectAllThatApply: true,
        correctAnswers: [],
      },
    ]);

    const blocks = collectAssessmentExportBlocks(assessment);
    expect(blocks[0].answerLine).toBe('Correct answer: A');
  });
});
