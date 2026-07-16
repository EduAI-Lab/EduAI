/**
 * Unit tests for Canvas Assessment Question Bank client helpers (mocked axios / test mode).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindOne = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  CanvasIntegration: { findOne: (...args) => mockFindOne(...args) },
  CanvasCourseMapping: {},
  Question_Metadata: {},
  Variants: {},
  AssessmentSections: {},
  SectionVariants: {},
  Course: {},
  CanvasBankMapping: {},
  CanvasBankQuestionMapping: {}
}));

vi.mock('../../src/services/assessmentService.js', () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn()
}));

vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: vi.fn()
}));

vi.mock('../../src/services/assessmentSectionService.js', () => ({
  createAssessmentSection: vi.fn()
}));

vi.mock('../../src/services/questionBankService.js', () => ({
  createBank: vi.fn(),
  addQuestionToBank: vi.fn()
}));

vi.mock('../../src/schema/QuestionBank.js', () => ({
  QuestionBank: { findOne: vi.fn() }
}));

vi.mock('axios', () => ({
  default: vi.fn()
}));

describe('getCanvasQuestionBanks / getCanvasQuestionBankQuestions', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockFindOne.mockResolvedValue({
      userId: 1,
      canvasUrl: 'https://canvas.test',
      apiKey: 'key',
      isTestMode: true
    });
  });

  it('returns mock banks in test mode', async () => {
    const { getCanvasQuestionBanks } = await import('../../src/services/canvasService.js');
    const banks = await getCanvasQuestionBanks(1, 1);
    expect(banks.length).toBeGreaterThan(0);
    expect(banks[0]).toHaveProperty('id');
    expect(banks[0]).toHaveProperty('title');
  });

  it('returns mock bank questions in test mode', async () => {
    const { getCanvasQuestionBankQuestions } = await import('../../src/services/canvasService.js');
    const questions = await getCanvasQuestionBankQuestions(1, 10);
    expect(questions.length).toBe(2);
    expect(questions[0].question_type).toBe('multiple_choice_question');
  });
});
