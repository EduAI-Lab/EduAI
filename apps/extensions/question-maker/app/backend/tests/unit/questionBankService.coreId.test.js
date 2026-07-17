/**
 * Unit tests for questionBankService coreQuestionId membership path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCourseFindOne,
  mockQuestionFindByPk,
  mockVariantsFindOne,
  mockVariantsFindAll,
  mockCanvasMappingFindAll,
  mockIsConfigured,
  mockListCourses,
  mockAddMembership,
  mockListMemberships,
} = vi.hoisted(() => ({
  mockCourseFindOne: vi.fn(),
  mockQuestionFindByPk: vi.fn(),
  mockVariantsFindOne: vi.fn(),
  mockVariantsFindAll: vi.fn(),
  mockCanvasMappingFindAll: vi.fn(),
  mockIsConfigured: vi.fn().mockReturnValue(true),
  mockListCourses: vi.fn(),
  mockAddMembership: vi.fn(),
  mockListMemberships: vi.fn(),
}));

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: mockIsConfigured,
    listCourses: mockListCourses,
    addQuestionBankMembership: mockAddMembership,
    listQuestionBankMemberships: mockListMemberships,
  },
}));

vi.mock('../../src/schema/index.js', () => ({
  Course: { findOne: mockCourseFindOne },
  Question_Metadata: { findByPk: mockQuestionFindByPk },
  Variants: {
    findOne: mockVariantsFindOne,
    findAll: mockVariantsFindAll,
  },
  CanvasBankQuestionMapping: { findAll: mockCanvasMappingFindAll },
}));

const {
  addQuestionToBank,
  listLocalQuestionIdsForBank,
  resolveCoreCourse,
} = await import('../../src/services/questionBankService.js');

const LOCAL_COURSE = { id: 1, userId: 1, code: 'COSC 211', coreCourseId: 'core_cosc211' };
const QUESTION = { id: 42, courseId: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindOne.mockResolvedValue(LOCAL_COURSE);
  mockQuestionFindByPk.mockResolvedValue(QUESTION);
  mockAddMembership.mockResolvedValue({ id: 'mem_1', questionId: 'cl_q1' });
});

describe('resolveCoreCourse', () => {
  it('prefers Course.coreCourseId when set', async () => {
    const result = await resolveCoreCourse(1, 1);
    expect(result.coreCourseId).toBe('core_cosc211');
    expect(mockListCourses).not.toHaveBeenCalled();
  });

  it('falls back to code match when coreCourseId is missing', async () => {
    mockCourseFindOne.mockResolvedValue({ ...LOCAL_COURSE, coreCourseId: null });
    mockListCourses.mockResolvedValue([{ id: 'core_from_list', code: 'COSC 211' }]);

    const result = await resolveCoreCourse(1, 1);
    expect(result.coreCourseId).toBe('core_from_list');
    expect(mockListCourses).toHaveBeenCalled();
  });
});

describe('addQuestionToBank', () => {
  it('rejects add when variant has no coreQuestionId', async () => {
    mockVariantsFindOne.mockResolvedValue(null);

    await expect(addQuestionToBank(1, 1, 'bank_core', 42)).rejects.toMatchObject({
      status: 409,
    });
    expect(mockAddMembership).not.toHaveBeenCalled();
  });

  it('posts coreQuestionId to Core membership API', async () => {
    mockVariantsFindOne.mockResolvedValue({ coreQuestionId: 'cl_q1' });

    await addQuestionToBank(1, 1, 'bank_core', 42);

    expect(mockAddMembership).toHaveBeenCalledWith('core_cosc211', 'bank_core', {
      questionId: 'cl_q1',
    });
  });
});

describe('listLocalQuestionIdsForBank', () => {
  it('maps Core question ids to local metadata ids and includes pending Canvas mappings', async () => {
    mockListMemberships.mockResolvedValue({
      memberships: [{ questionId: 'cl_q1' }, { questionId: 'cl_q2' }],
    });
    mockVariantsFindAll
      .mockResolvedValueOnce([{ questionMetadataId: 10 }, { questionMetadataId: 11 }])
      .mockResolvedValueOnce([{ questionMetadataId: 10 }]);
    mockCanvasMappingFindAll.mockResolvedValue([
      { localQuestionMetadataId: 99 },
      { localQuestionMetadataId: 10 },
    ]);

    const result = await listLocalQuestionIdsForBank(1, 1, 'bank_core');

    expect(result.memberIds.sort()).toEqual([10, 11]);
    expect(result.pendingIds).toEqual([99]);
  });
});
