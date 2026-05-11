/**
 * extractQuestionsFromText with mocked Course/Topics and EduAI — no real DB or network.
 * Uses ESM `jest.unstable_mockModule` so `aiService` sees the fakes.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const generateQuestions = jest.fn();
const findByPk = jest.fn();
const findAll = jest.fn();

await jest.unstable_mockModule('../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: () => true,
    generateQuestions,
  },
}));

await jest.unstable_mockModule('../src/schema/index.js', () => ({
  Question_Metadata: {},
  Course: { findByPk },
  Topics: { findAll },
}));

const { extractQuestionsFromText } = await import('../src/services/aiService.js');

describe('extractQuestionsFromText (EduAI mocked)', () => {
  beforeEach(() => {
    generateQuestions.mockReset();
    findByPk.mockReset();
    findAll.mockReset();
    findByPk.mockResolvedValue({
      id: 7,
      code: 'CS 101',
      name: 'Intro',
    });
    findAll.mockResolvedValue([]);
  });

  it('returns sanitized questions from EduAI output', async () => {
    generateQuestions.mockResolvedValue([
      {
        content: '1. What is 2+2? Show your work.',
        description: 'Basic addition',
        difficulty: 'easy',
        type: 'SA',
        answer: '4',
        primary_topic_id: null,
        secondary_topic_ids: [],
      },
    ]);

    const out = await extractQuestionsFromText('Exam paper snippet with a question.', 7, 'test:model', {});

    expect(findByPk).toHaveBeenCalledWith(7, { attributes: ['id', 'code', 'name'] });
    expect(findAll).toHaveBeenCalled();
    expect(generateQuestions).toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].question).toContain('2+2');
    expect(out[0].summary).toBe('Basic addition');
    expect(out[0].type).toBe('SA');
    expect(out[0].answer).toBe('4');
  });

  it('passes a synthetic course code when the course row is missing', async () => {
    findByPk.mockResolvedValue(null);
    generateQuestions.mockResolvedValue([
      {
        content: 'Q?',
        description: 'Short',
        difficulty: 'medium',
        type: 'SA',
        answer: null,
        primary_topic_id: null,
        secondary_topic_ids: [],
      },
    ]);

    await extractQuestionsFromText('Some exam text for extraction.', 99, 'm', {});

    const call = generateQuestions.mock.calls[0][0];
    expect(call.courseCode).toBe('COURSE-UNKNOWN');
  });
});
