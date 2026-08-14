/**
 * Unit tests for QM questionBankService (Core proxy).
 * Mocks Prisma + coreApiService — no live Core or DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseFindUnique = vi.fn();
const questionFindUnique = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findUnique: courseFindUnique },
    questionMetadata: { findUnique: questionFindUnique },
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  listQuestionBanksFromCore: vi.fn(),
  createQuestionBankOnCore: vi.fn(),
  updateQuestionBankOnCore: vi.fn(),
  deleteQuestionBankOnCore: vi.fn(),
  listQuestionBankMembershipsFromCore: vi.fn(),
  addQuestionBankMembershipOnCore: vi.fn(),
  removeQuestionBankMembershipOnCore: vi.fn(),
}));

const {
  listQuestionBanksFromCore,
  createQuestionBankOnCore,
  updateQuestionBankOnCore,
  deleteQuestionBankOnCore,
  addQuestionBankMembershipOnCore,
  removeQuestionBankMembershipOnCore,
  listQuestionBankMembershipsFromCore,
} = await import('../../src/services/coreApiService.js');

const {
  listBanks,
  createBank,
  updateBank,
  deleteBank,
  ensureDefaultBank,
  attachQuestionToBanks,
  backfillDefaultBanks,
  resolveCoreCourse,
  addQuestionToBank,
  removeQuestionFromBank,
  listExternalQuestionIdsForBank,
} = await import('../../src/services/questionBankService.js');

const USER_ID = 'user_cuid';
const LOCAL_COURSE = {
  id: 9,
  coreCourseId: 'core_course_1',
  name: 'CS 101',
};

beforeEach(() => {
  vi.clearAllMocks();
  courseFindUnique.mockResolvedValue(LOCAL_COURSE);
});

describe('resolveCoreCourse', () => {
  it('rejects a non-integer course id', async () => {
    await expect(resolveCoreCourse('abc', USER_ID)).rejects.toMatchObject({
      message: 'Invalid course id',
      status: 400,
    });
  });

  it('rejects when the local course is missing', async () => {
    courseFindUnique.mockResolvedValue(null);
    await expect(resolveCoreCourse(9, USER_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Course not found',
    });
  });

  it('rejects when the course is not linked to Core', async () => {
    courseFindUnique.mockResolvedValue({ id: 9, coreCourseId: null });
    await expect(resolveCoreCourse(9, USER_ID)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not linked to EduAI Core'),
    });
  });

  it('returns local course + coreCourseId when linked', async () => {
    await expect(resolveCoreCourse(9, USER_ID)).resolves.toEqual({
      localCourse: LOCAL_COURSE,
      coreCourseId: 'core_course_1',
    });
  });
});

describe('listBanks', () => {
  it('maps Core banks onto the local course id', async () => {
    listQuestionBanksFromCore.mockResolvedValue({
      banks: [
        {
          id: 'bank_default',
          name: 'Course bank',
          description: null,
          isDefault: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });

    await expect(listBanks(9, USER_ID)).resolves.toEqual([
      {
        id: 'bank_default',
        courseId: 9,
        name: 'Course bank',
        description: null,
        isDefault: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]);
    expect(listQuestionBanksFromCore).toHaveBeenCalledWith('core_course_1');
  });
});

describe('createBank', () => {
  it('rejects an empty name', async () => {
    await expect(createBank(9, USER_ID, { name: '  ' })).rejects.toMatchObject({
      status: 400,
      message: 'Bank name is required',
    });
  });

  it('creates via Core and remaps courseId', async () => {
    createQuestionBankOnCore.mockResolvedValue({
      id: 'bank_new',
      name: 'Midterm',
      description: null,
      isDefault: false,
      createdAt: 't',
      updatedAt: 't',
    });

    await expect(createBank(9, USER_ID, { name: ' Midterm ' })).resolves.toMatchObject({
      id: 'bank_new',
      courseId: 9,
      name: 'Midterm',
      isDefault: false,
    });
    expect(createQuestionBankOnCore).toHaveBeenCalledWith('core_course_1', {
      name: 'Midterm',
      description: null,
    });
  });
});

describe('addQuestionToBank', () => {
  it('rejects a missing question', async () => {
    questionFindUnique.mockResolvedValue(null);
    await expect(addQuestionToBank(9, USER_ID, 'bank_1', 42)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects a question from another course', async () => {
    questionFindUnique.mockResolvedValue({ id: 42, courseId: 99 });
    await expect(addQuestionToBank(9, USER_ID, 'bank_1', 42)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('same course'),
    });
  });

  it('posts membership with QM question id as externalQuestionId', async () => {
    questionFindUnique.mockResolvedValue({ id: 42, courseId: 9 });
    addQuestionBankMembershipOnCore.mockResolvedValue({ id: 'mem_1' });

    await expect(addQuestionToBank(9, USER_ID, 'bank_1', 42)).resolves.toEqual({
      membership: { id: 'mem_1' },
      created: true,
    });
    expect(addQuestionBankMembershipOnCore).toHaveBeenCalledWith(
      'core_course_1',
      'bank_1',
      { externalQuestionId: '42', source: 'question-maker' },
    );
  });
});

describe('removeQuestionFromBank', () => {
  it('deletes membership on Core', async () => {
    removeQuestionBankMembershipOnCore.mockResolvedValue({ removed: true });

    await expect(removeQuestionFromBank(9, USER_ID, 'bank_1', 42)).resolves.toEqual({
      removed: true,
    });
    expect(removeQuestionBankMembershipOnCore).toHaveBeenCalledWith(
      'core_course_1',
      'bank_1',
      '42',
      'question-maker',
    );
  });
});

describe('listExternalQuestionIdsForBank', () => {
  it('returns integer QM question ids for question-maker memberships', async () => {
    listQuestionBankMembershipsFromCore.mockResolvedValue({
      memberships: [
        { source: 'question-maker', externalQuestionId: '10' },
        { source: 'other', externalQuestionId: '11' },
        { source: 'question-maker', externalQuestionId: 'not-a-number' },
        { source: 'question-maker', externalQuestionId: '12' },
      ],
    });

    await expect(listExternalQuestionIdsForBank(9, USER_ID, 'bank_1')).resolves.toEqual([
      10, 12,
    ]);
  });
});

describe('updateBank / deleteBank / ensureDefaultBank / attachQuestionToBanks', () => {
  it('updateBank remaps Core response', async () => {
    updateQuestionBankOnCore.mockResolvedValue({
      id: 'bank_1',
      name: 'Renamed',
      description: null,
      isDefault: false,
      createdAt: 't',
      updatedAt: 't',
    });

    await expect(
      updateBank(9, USER_ID, 'bank_1', { name: 'Renamed' }),
    ).resolves.toMatchObject({ id: 'bank_1', courseId: 9, name: 'Renamed' });
  });

  it('deleteBank forwards moveMembershipsToBankId', async () => {
    deleteQuestionBankOnCore.mockResolvedValue({ success: true });
    await expect(
      deleteBank(9, USER_ID, 'bank_1', { moveMembershipsToBankId: 'bank_default' }),
    ).resolves.toEqual({ success: true });
    expect(deleteQuestionBankOnCore).toHaveBeenCalledWith(
      'core_course_1',
      'bank_1',
      { moveMembershipsToBankId: 'bank_default' },
    );
  });

  it('ensureDefaultBank returns the default from Core', async () => {
    listQuestionBanksFromCore.mockResolvedValue({
      banks: [
        {
          id: 'bank_default',
          name: 'Course bank',
          description: null,
          isDefault: true,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    await expect(ensureDefaultBank(9, USER_ID)).resolves.toMatchObject({
      id: 'bank_default',
      isDefault: true,
      courseId: 9,
    });
  });

  it('ensureDefaultBank throws when Core has no isDefault bank', async () => {
    listQuestionBanksFromCore.mockResolvedValue({
      banks: [
        {
          id: 'bank_other',
          name: 'Other',
          description: null,
          isDefault: false,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    await expect(ensureDefaultBank(9, USER_ID)).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/Failed to ensure default/),
    });
  });

  it('attachQuestionToBanks uses explicit ids', async () => {
    questionFindUnique.mockResolvedValue({ id: 42, courseId: 9 });
    addQuestionBankMembershipOnCore.mockResolvedValue({ id: 'm1' });
    await expect(
      attachQuestionToBanks(9, USER_ID, 42, { questionBankIds: ['bank_a', 'bank_b'] }),
    ).resolves.toEqual(['bank_a', 'bank_b']);
    expect(addQuestionBankMembershipOnCore).toHaveBeenCalledTimes(2);
  });

  it('backfillDefaultBanks is a no-op', async () => {
    await expect(backfillDefaultBanks()).resolves.toEqual({
      coursesProcessed: 0,
      banksCreated: 0,
      membershipsCreated: 0,
    });
  });
});
