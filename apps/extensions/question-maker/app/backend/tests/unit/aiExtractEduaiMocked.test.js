/**
 * extractQuestionsFromText with mocked Course/Topics and EduAI — no real DB or network.
 * Uses ESM `vi.mock` so `aiService` sees the fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateQuestions = vi.fn();
const findByPk = vi.fn();
const findAll = vi.fn();

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: () => true,
    generateQuestions,
  },
}));

vi.mock('../../src/schema/index.js', () => ({
  Question_Metadata: {},
  Course: { findByPk },
  Topics: { findAll },
}));

const { extractQuestionsFromText } = await import('../../src/services/aiService.js');

describe('extractQuestionsFromText (EduAI mocked)', () => {
  beforeEach(() => {
    generateQuestions.mockReset();
    findByPk.mockReset();
    findAll.mockReset();
    // `code`/`name` are Core-owned and no longer stored locally (#1072 §4
    // step 10) — a course with no `coreCourseId` degrades to the placeholder
    // in `enrichCourseDetail`, so the extraction prompt falls back to
    // `COURSE-<id>` for its display code (this test only checks the
    // `findByPk` call shape; the missing-course fallback is covered below).
    findByPk.mockResolvedValue({
      id: 7,
      coreCourseId: null,
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

    expect(findByPk).toHaveBeenCalledWith(7, { attributes: ['id', 'coreCourseId'] });
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
