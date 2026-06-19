/**
 * Unit tests for syncTopicsFromCoreForCourse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const topicsFindAll = vi.fn();
const topicsCreate = vi.fn();
const topicUpdate = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Topics: {
    findAll: topicsFindAll,
    create: topicsCreate,
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  getCourseTopicsFromCore: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const { getCourseTopicsFromCore } = await import('../../src/services/coreApiService.js');
const { syncTopicsFromCoreForCourse } = await import('../../src/services/topicSyncService.js');

describe('syncTopicsFromCoreForCourse', () => {
  const course = { id: 10, coreCourseId: 'core-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    topicsCreate.mockImplementation(async (data) => ({ id: 99, ...data, update: topicUpdate }));
  });

  it('returns 0 when the course is not linked to Core', async () => {
    await expect(syncTopicsFromCoreForCourse({ id: 1, coreCourseId: null }, 'session=abc')).resolves.toBe(0);
    expect(getCourseTopicsFromCore).not.toHaveBeenCalled();
  });

  it('batch-loads local topics instead of querying per Core topic', async () => {
    getCourseTopicsFromCore.mockResolvedValue({
      topics: [
        { id: 'ct-1', name: 'Algorithms' },
        { id: 'ct-2', name: 'Data Structures' },
      ],
    });
    topicsFindAll.mockImplementation(async ({ where }) => {
      if (where.courseId) {
        return [{ id: 1, name: 'Data Structures', courseId: 10, update: topicUpdate }];
      }
      return [];
    });

    const synced = await syncTopicsFromCoreForCourse(course, 'session=abc');

    expect(synced).toBe(2);
    expect(topicsFindAll).toHaveBeenCalledTimes(2);
    expect(topicsCreate).toHaveBeenCalledWith({
      name: 'Algorithms',
      courseId: 10,
      coreTopicId: 'ct-1',
    });
    expect(topicUpdate).toHaveBeenCalledWith({ coreTopicId: 'ct-2' });
  });

  it('skips Core topics already linked to another local course', async () => {
    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'ct-1', name: 'Shared Topic' }],
    });
    topicsFindAll.mockImplementation(async ({ where }) => {
      if (where.courseId) return [];
      return [{ id: 5, name: 'Shared Topic', courseId: 99, coreTopicId: 'ct-1', update: topicUpdate }];
    });

    const synced = await syncTopicsFromCoreForCourse(course, 'session=abc');

    expect(synced).toBe(0);
    expect(topicsCreate).not.toHaveBeenCalled();
  });

  it('rethrows Core errors when failOnCoreError is set', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    getCourseTopicsFromCore.mockRejectedValue(err);

    await expect(
      syncTopicsFromCoreForCourse(course, 'session=abc', { failOnCoreError: true }),
    ).rejects.toBe(err);
  });
});
