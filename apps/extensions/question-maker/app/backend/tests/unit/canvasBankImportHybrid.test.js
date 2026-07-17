/**
 * Unit tests for Canvas bank hybrid import: first import vs re-sync push path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIntegrationFindOne,
  mockCourseFindOne,
  mockListBanks,
  mockCreateBank,
  mockAddQuestionToBank,
  mockBankMappingFindOne,
  mockBankMappingFindOrCreate,
  mockBankMappingUpdate,
  mockQMapFindOne,
  mockQMapCreate,
  mockQMapUpdate,
  mockMetadataCreate,
  mockMetadataFindByPk,
  mockMetadataUpdate,
  mockVariantsCreate,
  mockVariantsFindAll,
  mockVariantUpdate,
  mockPushVariantToCore,
} = vi.hoisted(() => ({
  mockIntegrationFindOne: vi.fn(),
  mockCourseFindOne: vi.fn(),
  mockListBanks: vi.fn(),
  mockCreateBank: vi.fn(),
  mockAddQuestionToBank: vi.fn(),
  mockBankMappingFindOne: vi.fn(),
  mockBankMappingFindOrCreate: vi.fn(),
  mockBankMappingUpdate: vi.fn(),
  mockQMapFindOne: vi.fn(),
  mockQMapCreate: vi.fn(),
  mockQMapUpdate: vi.fn(),
  mockMetadataCreate: vi.fn(),
  mockMetadataFindByPk: vi.fn(),
  mockMetadataUpdate: vi.fn(),
  mockVariantsCreate: vi.fn(),
  mockVariantsFindAll: vi.fn(),
  mockVariantUpdate: vi.fn(),
  mockPushVariantToCore: vi.fn(),
}));

vi.mock('../../src/schema/index.js', () => ({
  CanvasIntegration: { findOne: mockIntegrationFindOne },
  CanvasCourseMapping: {},
  Question_Metadata: {
    create: mockMetadataCreate,
    findByPk: mockMetadataFindByPk,
  },
  Variants: {
    create: mockVariantsCreate,
    findAll: mockVariantsFindAll,
  },
  AssessmentSections: {},
  SectionVariants: {},
  Course: { findOne: mockCourseFindOne },
  CanvasBankMapping: {
    findOne: mockBankMappingFindOne,
    findOrCreate: mockBankMappingFindOrCreate,
  },
  CanvasBankQuestionMapping: {
    findOne: mockQMapFindOne,
    create: mockQMapCreate,
  },
}));

vi.mock('../../src/services/questionBankService.js', () => ({
  listBanks: mockListBanks,
  createBank: mockCreateBank,
  addQuestionToBank: mockAddQuestionToBank,
}));

vi.mock('../../src/services/coreWiringService.js', () => ({
  pushVariantToCore: mockPushVariantToCore,
}));

vi.mock('../../src/services/questionService.js', () => ({
  createQuestion: vi.fn(),
}));

const { importQuestionBankFromCanvas } = await import('../../src/services/canvasService.js');

const USER_ID = 1;
const LOCAL_COURSE_ID = 5;
const CANVAS_COURSE_ID = 101;
const CANVAS_BANK_ID = 10;
const PRIMARY_TOPIC_ID = 1;
const COOKIE = 'session=test-cookie';

function setupCommonMocks({ existingBankMapping = null } = {}) {
  mockIntegrationFindOne.mockResolvedValue({
    userId: USER_ID,
    isTestMode: true,
    canvasUrl: 'https://canvas.test',
    apiKey: 'key',
  });
  mockCourseFindOne.mockResolvedValue({
    id: LOCAL_COURSE_ID,
    name: 'Test Course',
    coreCourseId: 'core-course-1',
  });
  mockListBanks.mockResolvedValue([]);
  mockBankMappingFindOne.mockResolvedValue(existingBankMapping);
  mockCreateBank.mockResolvedValue({ id: 'local-bank-1' });
  mockBankMappingFindOrCreate.mockResolvedValue([
    {
      localBankId: 'local-bank-1',
      update: mockBankMappingUpdate.mockResolvedValue(undefined),
    },
    true,
  ]);
  mockQMapFindOne.mockResolvedValue(null);
  mockMetadataCreate.mockImplementation(async (data) => ({
    id: 200,
    ...data,
    update: mockMetadataUpdate.mockResolvedValue(undefined),
  }));
  mockVariantsCreate.mockImplementation(async (data) => ({
    id: 300,
    ...data,
    update: mockVariantUpdate.mockResolvedValue(undefined),
  }));
  mockQMapCreate.mockResolvedValue({ id: 1 });
  mockPushVariantToCore.mockResolvedValue({ coreQuestionId: 'core-q-1' });
  mockAddQuestionToBank.mockResolvedValue({ membership: { id: 'mem-1' }, created: true });
}

describe('importQuestionBankFromCanvas hybrid flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('first import creates mapping but does not call addQuestionToBank', async () => {
    setupCommonMocks({ existingBankMapping: null });

    const result = await importQuestionBankFromCanvas(
      USER_ID,
      CANVAS_COURSE_ID,
      CANVAS_BANK_ID,
      LOCAL_COURSE_ID,
      { primaryTopicId: PRIMARY_TOPIC_ID },
    );

    expect(result.created).toBeGreaterThan(0);
    expect(mockQMapCreate).toHaveBeenCalled();
    expect(mockAddQuestionToBank).not.toHaveBeenCalled();
    expect(mockPushVariantToCore).not.toHaveBeenCalled();
  });

  it('re-sync with existing mapping pushes then adds membership', async () => {
    setupCommonMocks({
      existingBankMapping: {
        localBankId: 'local-bank-1',
        canvasBankId: CANVAS_BANK_ID,
      },
    });
    mockListBanks.mockResolvedValue([{ id: 'local-bank-1', name: 'Chapter 1 Bank' }]);

    const existingMetadata = {
      id: 150,
      courseId: LOCAL_COURSE_ID,
      type: 'MCQ',
      description: 'Old',
      update: mockMetadataUpdate.mockResolvedValue(undefined),
    };
    const existingVariant = {
      id: 250,
      questionMetadataId: 150,
      questionText: 'Old text',
      update: mockVariantUpdate.mockResolvedValue(undefined),
    };

    mockQMapFindOne.mockResolvedValue({
      localQuestionMetadataId: 150,
      canvasAssessmentQuestionId: 101,
      update: mockQMapUpdate.mockResolvedValue(undefined),
    });
    mockMetadataFindByPk.mockResolvedValue(existingMetadata);
    mockVariantsFindAll.mockResolvedValue([existingVariant]);

    const result = await importQuestionBankFromCanvas(
      USER_ID,
      CANVAS_COURSE_ID,
      CANVAS_BANK_ID,
      LOCAL_COURSE_ID,
      { primaryTopicId: PRIMARY_TOPIC_ID, cookieHeader: COOKIE },
    );

    expect(result.updated).toBeGreaterThan(0);
    expect(mockPushVariantToCore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 250 }),
      expect.objectContaining({ coreCourseId: 'core-course-1' }),
      COOKIE,
    );
    expect(mockVariantUpdate).toHaveBeenCalledWith({ coreQuestionId: 'core-q-1' });
    expect(mockAddQuestionToBank).toHaveBeenCalledWith(
      LOCAL_COURSE_ID,
      USER_ID,
      'local-bank-1',
      150,
    );
  });

  it('re-sync fails with 400 when course lacks coreCourseId', async () => {
    setupCommonMocks({
      existingBankMapping: { localBankId: 'local-bank-1' },
    });
    mockCourseFindOne.mockResolvedValue({
      id: LOCAL_COURSE_ID,
      name: 'Test Course',
      coreCourseId: null,
    });

    await expect(
      importQuestionBankFromCanvas(
        USER_ID,
        CANVAS_COURSE_ID,
        CANVAS_BANK_ID,
        LOCAL_COURSE_ID,
        { primaryTopicId: PRIMARY_TOPIC_ID, cookieHeader: COOKIE },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
