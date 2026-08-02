/**
 * Unit tests for importQuestionBankFromCanvas (#845).
 * Mocks Prisma, Canvas HTTP (axios), and Core bank helpers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosRequest = vi.fn();

vi.mock('axios', () => ({
  default: axiosRequest,
}));

vi.mock('../../src/utils/encryption.js', () => ({
  encrypt: (v) => v,
  decrypt: (v) => v,
  isEncrypted: () => false,
}));

vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: vi.fn(),
}));

vi.mock('../../src/services/assessmentService.js', () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn(),
}));

vi.mock('../../src/services/assessmentSectionService.js', () => ({
  createAssessmentSection: vi.fn(),
}));

vi.mock('../../src/services/questionBankService.js', () => ({
  listBanks: vi.fn(),
  createBank: vi.fn(),
  addQuestionsToBank: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    canvasIntegration: { findUnique: vi.fn() },
    course: { findFirst: vi.fn() },
    canvasBankMapping: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    canvasBankQuestionMapping: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    questionMetadata: { findUnique: vi.fn(), update: vi.fn() },
    variants: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn) => fn({
      questionMetadata: { update: vi.fn() },
      variants: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn() },
      canvasBankQuestionMapping: { update: vi.fn(), create: vi.fn() },
    })),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { prisma } = await import('../../src/config/database.js');
const { listBanks, createBank, addQuestionsToBank } = await import(
  '../../src/services/questionBankService.js'
);
const { createQuestion } = await import('../../src/services/questionService.js');
const { importQuestionBankFromCanvas } = await import(
  '../../src/services/canvasService.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) =>
    fn({
      questionMetadata: { update: prisma.questionMetadata.update },
      variants: {
        findMany: prisma.variants.findMany,
        update: prisma.variants.update,
        create: prisma.variants.create,
      },
      canvasBankQuestionMapping: {
        update: prisma.canvasBankQuestionMapping.update,
        create: prisma.canvasBankQuestionMapping.create,
      },
    }),
  );
  prisma.canvasIntegration.findUnique.mockResolvedValue({
    userId: 'u1',
    canvasUrl: 'https://canvas.example.edu',
    apiKey: 'token',
    isTestMode: false,
  });
  prisma.course.findFirst.mockResolvedValue({
    id: 9,
    coreCourseId: 'core_1',
    userId: 'owner',
  });
  listBanks.mockResolvedValue([{ id: 'bank_default', name: 'Course bank' }]);
  prisma.canvasBankMapping.findUnique.mockResolvedValue(null);
  prisma.canvasBankMapping.upsert.mockResolvedValue({ id: 1 });
  prisma.canvasBankMapping.update.mockResolvedValue({
    id: 1,
    lastSyncedAt: new Date('2026-07-29T00:00:00Z'),
  });
  createBank.mockResolvedValue({ id: 'bank_new', name: 'Chapter 1' });
  addQuestionsToBank.mockResolvedValue({ added: 0 });
  axiosRequest.mockImplementation(async (config) => {
    if (String(config.url).includes('/questions')) {
      return { data: [] };
    }
    if (String(config.url).includes('/question_banks/')) {
      return { data: { id: 10, title: 'Chapter 1' } };
    }
    return { data: [] };
  });
});

describe('importQuestionBankFromCanvas', () => {
  it('throws when Canvas is not connected', async () => {
    prisma.canvasIntegration.findUnique.mockResolvedValue(null);
    await expect(
      importQuestionBankFromCanvas('u1', 1, 10, 9, { primaryTopicId: 't1' }),
    ).rejects.toThrow(/Canvas integration not configured/);
  });

  it('throws 404 when the local course is missing', async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    await expect(
      importQuestionBankFromCanvas('u1', 1, 10, 9, { primaryTopicId: 't1' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('requires a primary topic', async () => {
    await expect(importQuestionBankFromCanvas('u1', 1, 10, 9, {})).rejects.toThrow(
      /Primary topic ID is required/,
    );
  });

  it('rejects a missing targetBankId', async () => {
    await expect(
      importQuestionBankFromCanvas('u1', 1, 10, 9, {
        primaryTopicId: 't1',
        targetBankId: 'missing',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('creates a Core bank and imports convertible questions', async () => {
    axiosRequest.mockImplementation(async (config) => {
      if (String(config.url).includes('/questions')) {
        return {
          data: [
            {
              id: 100,
              question_text: 'Explain polymorphism',
              question_type: 'essay_question',
            },
          ],
        };
      }
      return { data: { id: 10, title: 'Chapter 1' } };
    });
    prisma.canvasBankQuestionMapping.findUnique.mockResolvedValue(null);
    createQuestion.mockResolvedValue({ id: 55 });
    prisma.variants.create.mockResolvedValue({});
    prisma.canvasBankQuestionMapping.create.mockResolvedValue({});
    addQuestionsToBank.mockResolvedValue({ added: 1 });

    const result = await importQuestionBankFromCanvas('u1', 1, 10, 9, {
      primaryTopicId: 'topic_1',
    });

    expect(createBank).toHaveBeenCalled();
    expect(createQuestion).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ skipBankAttach: true }),
    );
    expect(addQuestionsToBank).toHaveBeenCalledWith(9, 'u1', 'bank_new', [55]);
    expect(prisma.canvasBankMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_canvasBankId_localCourseId: {
            userId: 'u1',
            canvasBankId: 10,
            localCourseId: 9,
          },
        },
      }),
    );
    expect(result).toMatchObject({
      bankId: 'bank_new',
      created: 1,
      updated: 0,
      truncated: false,
    });
  });

  it('reuses targetBankId when provided', async () => {
    listBanks.mockResolvedValue([{ id: 'bank_extra', name: 'Extra' }]);
    const result = await importQuestionBankFromCanvas('u1', 1, 10, 9, {
      primaryTopicId: 't1',
      targetBankId: 'bank_extra',
    });
    expect(createBank).not.toHaveBeenCalled();
    expect(result.bankId).toBe('bank_extra');
  });

  it('skips remote rows without an id', async () => {
    listBanks.mockResolvedValue([{ id: 'bank_extra', name: 'Extra' }]);
    axiosRequest.mockImplementation(async (config) => {
      if (String(config.url).includes('/questions')) {
        return { data: [{ question_text: 'orphan' }] };
      }
      return { data: { id: 10, title: 'Chapter 1' } };
    });

    const result = await importQuestionBankFromCanvas('u1', 1, 10, 9, {
      primaryTopicId: 't1',
      targetBankId: 'bank_extra',
    });
    expect(result.skipped).toBe(1);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(addQuestionsToBank).not.toHaveBeenCalled();
  });

  it('rejects non-numeric canvas ids', async () => {
    await expect(
      importQuestionBankFromCanvas('u1', '123&context_type=Account', 10, 9, {
        primaryTopicId: 't1',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
