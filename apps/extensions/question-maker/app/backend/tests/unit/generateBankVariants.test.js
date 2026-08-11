/**
 * Unit tests for generateBankVariantsForQuestions orchestration.
 *
 * The AI boundary (eduaiService) is mocked — these tests verify the orchestration contract:
 * - validation guards before any AI call is made
 * - the primary variant of each question is promoted to non-draft before generation
 * - MCQ choice-count retry fires when the model returns the wrong count
 * - errors are recorded per-question, not thrown, so other questions still process
 * - isAiGenerated=true and isDraft=true are set on all generated variants (drafts pending review)
 * - referenceId is set to the primary variant's id
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---- hoisted mocks ---------------------------------------------------------
const {
  mockIsConfigured,
  mockGenerateQuestions,
  mockCourseFindOne,
  mockTopicsFindAll,
  mockMetaFindMany,
  mockVariantCreate,
  mockVariantUpdate,
} = vi.hoisted(() => ({
  mockIsConfigured: vi.fn().mockReturnValue(true),
  mockGenerateQuestions: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockTopicsFindAll: vi.fn().mockResolvedValue([]),
  mockMetaFindMany: vi.fn(),
  mockVariantCreate: vi.fn(),
  mockVariantUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: mockIsConfigured,
    generateQuestions: mockGenerateQuestions,
  },
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = {
    port: 8000,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    coreUrl: 'http://core.test',
    extensionUrl: 'http://localhost:8000',
    encryptionKey: 'test-encryption-key-32bytes!!!!!',
    corsOrigins: ['*'],
    groqApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    eduaiApiUrl: 'https://eduai.ok.ubc.ca',
    eduaiApiKey: 'test-service-key',
    eduaiIgnoredCourseCodes: [],
    defaultNumQuestions: 15,
    maxQuestions: 50,
    rateLimitWindowMs: 900000,
    rateLimitMax: 1000,
    logLevel: 'silent',
  };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findFirst: mockCourseFindOne },
    topics: { findMany: mockTopicsFindAll },
    // The service prefetches every requested question in one batched read, so the
    // mock resolves an array of the metadata rows visible for that course.
    questionMetadata: { findMany: mockMetaFindMany },
    variants: { create: mockVariantCreate, update: mockVariantUpdate },
  },
}));

const { generateBankVariantsForQuestions } = await import(
  '../../src/services/assessmentVariantService.js'
);

// ---------------------------------------------------------------------------

const USER_ID = 'cuid-user-1';
const COURSE = { id: 1, code: 'CS 101', name: 'Intro to CS' };
const BASE_PARAMS = { courseId: 1, questionIds: [10], variantsToAdd: 1 };

function makeMeta({ id = 10, type = 'SA', variants = [] } = {}) {
  return { id, type, courseId: 1, variants };
}

function makePrimaryVariant(overrides = {}) {
  return {
    id: 100,
    questionText: 'What is recursion?',
    difficulty: 'medium',
    reasoningLevel: 'factual',
    choices: null,
    secondaryTopicsId: [],
    ...overrides,
  };
}

function makeGeneratedQuestion(overrides = {}) {
  return [{ content: 'New variant text', difficulty: 'medium', reasoning_level: 'factual', answer: null, choices: null, ...overrides }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockTopicsFindAll.mockResolvedValue([]);
  mockVariantCreate.mockResolvedValue({ id: 200 });
});

// ---------------------------------------------------------------------------

describe('generateBankVariantsForQuestions — validation guards', () => {
  it('throws when courseId is missing', async () => {
    await expect(
      generateBankVariantsForQuestions(USER_ID, { questionIds: [10] })
    ).rejects.toThrow(/courseId.*required|required/i);
  });

  it('throws when questionIds is empty', async () => {
    await expect(
      generateBankVariantsForQuestions(USER_ID, { courseId: 1, questionIds: [] })
    ).rejects.toThrow(/required/i);
  });

  it('throws when questionIds is not an array', async () => {
    await expect(
      generateBankVariantsForQuestions(USER_ID, { courseId: 1, questionIds: 10 })
    ).rejects.toThrow(/required/i);
  });

  it('throws when the course is not found', async () => {
    mockCourseFindOne.mockResolvedValueOnce(null);
    await expect(
      generateBankVariantsForQuestions(USER_ID, BASE_PARAMS)
    ).rejects.toThrow(/course not found/i);
  });

  it('throws when eduaiService is not configured', async () => {
    mockIsConfigured.mockReturnValueOnce(false);
    await expect(
      generateBankVariantsForQuestions(USER_ID, BASE_PARAMS)
    ).rejects.toThrow(/not configured/i);
  });
});

// ---------------------------------------------------------------------------

describe('generateBankVariantsForQuestions — per-question orchestration', () => {
  it('records an error (does not throw) when a question is not found in the DB', async () => {
    // The batched read returns no row for the id, i.e. it does not exist or is not
    // visible for this course.
    mockMetaFindMany.mockResolvedValueOnce([]);

    const { results, errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);
    expect(errors[0].error).toMatch(/not found|no variants/i);
  });

  it('records an error when a question has no variants in the DB', async () => {
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [] })]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);
  });

  it('promotes the first (primary) variant to isDraft=false before calling AI', async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { isDraft: false } });
  });

  it('calls generateQuestions once per variantsToAdd iteration', async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions
      .mockResolvedValueOnce(makeGeneratedQuestion())
      .mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, { courseId: 1, questionIds: [10], variantsToAdd: 2 });

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
  });

  it('creates a variant with isAiGenerated=true and isDraft=true (draft pending review)', async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isAiGenerated: true, isDraft: true }),
    });
  });

  it('returns full createdVariants payloads for in-place review', async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    const { results } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(results[0].createdVariants).toEqual([
      expect.objectContaining({ id: 200, questionMetadataId: 10, isDraft: true })
    ]);
  });

  it('sets referenceId to the primary variant id on the created variant', async () => {
    const primary = makePrimaryVariant({ id: 777 });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ referenceId: 777 }),
    });
  });

  it('continues processing remaining questions after one fails — does not abort the batch', async () => {
    // qid 10 → absent from the batched read (error); qid 20 → present (result)
    mockMetaFindMany.mockResolvedValueOnce([
      makeMeta({ id: 20, variants: [makePrimaryVariant()] })
    ]);
    mockGenerateQuestions.mockResolvedValueOnce(makeGeneratedQuestion());

    const { results, errors } = await generateBankVariantsForQuestions(USER_ID, {
      courseId: 1,
      questionIds: [10, 20],
      variantsToAdd: 1
    });

    // The failed question lands in errors; the successful one lands in results
    expect(errors).toHaveLength(1);
    expect(errors[0].questionId).toBe(10);

    // Only the successfully processed question produces a result entry
    expect(results).toHaveLength(1);
    expect(results[0].questionId).toBe(20);
  });
});

// ---------------------------------------------------------------------------

describe('generateBankVariantsForQuestions — MCQ choice-count retry', () => {
  it('triggers a retry call when the model returns the wrong number of MCQ choices', async () => {
    const choices = [
      { letter: 'A', text: 'First' },
      { letter: 'B', text: 'Second' },
      { letter: 'C', text: 'Third' }
    ];
    const primary = makePrimaryVariant({
      choices,
      difficulty: 'easy',
      reasoningLevel: 'factual'
    });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ type: 'MCQ', variants: [primary] })]);

    // First call returns only 1 choice (wrong count) → retry
    mockGenerateQuestions
      .mockResolvedValueOnce([{
        content: 'MCQ wrong count',
        difficulty: 'easy',
        reasoning_level: 'factual',
        answer: 'A',
        choices: [{ letter: 'A', text: 'Only one' }]
      }])
      .mockResolvedValueOnce([{
        content: 'MCQ correct count',
        difficulty: 'easy',
        reasoning_level: 'factual',
        answer: 'A',
        choices
      }]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(mockGenerateQuestions).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(0);
  });

  it('records an error when the retry still returns the wrong MCQ choice count', async () => {
    const choices = [
      { letter: 'A', text: 'One' },
      { letter: 'B', text: 'Two' },
      { letter: 'C', text: 'Three' }
    ];
    const primary = makePrimaryVariant({ choices });
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ type: 'MCQ', variants: [primary] })]);

    const wrongCount = [{ content: 'X', difficulty: 'medium', reasoning_level: 'factual', answer: 'A', choices: [{ letter: 'A', text: 'Only' }] }];
    mockGenerateQuestions.mockResolvedValue(wrongCount);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].questionId).toBe(10);
  });

  it('records an error (not a throw) when the AI returns no content', async () => {
    const primary = makePrimaryVariant();
    mockMetaFindMany.mockResolvedValueOnce([makeMeta({ variants: [primary] })]);
    mockGenerateQuestions.mockResolvedValueOnce([{ content: null }]);

    const { errors } = await generateBankVariantsForQuestions(USER_ID, BASE_PARAMS);

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/no question content/i);
  });
});
