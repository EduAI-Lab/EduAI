/**
 * Unit tests for syncTopicsFromCoreForCourse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const topicsFindMany = vi.fn();
const topicsCreate = vi.fn();
const topicsUpdate = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    topics: {
      findMany: topicsFindMany,
      create: topicsCreate,
      update: topicsUpdate,
    },
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
    topicsCreate.mockImplementation(async ({ data }) => ({ id: 99, ...data }));
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
    topicsFindMany.mockImplementation(async ({ where }) => {
      if (where.courseId) {
        return [{ id: 1, name: 'Data Structures', courseId: 10 }];
      }
      return [];
    });

    const synced = await syncTopicsFromCoreForCourse(course, 'session=abc');

    expect(synced).toBe(2);
    expect(topicsFindMany).toHaveBeenCalledTimes(2);
    expect(topicsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Algorithms',
        courseId: 10,
        coreTopicId: 'ct-1',
      }),
    });
    expect(topicsUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { coreTopicId: 'ct-2' } });
  });

  it('skips Core topics already linked to another local course', async () => {
    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'ct-1', name: 'Shared Topic' }],
    });
    topicsFindMany.mockImplementation(async ({ where }) => {
      if (where.courseId) return [];
      return [{ id: 5, name: 'Shared Topic', courseId: 99, coreTopicId: 'ct-1' }];
    });

    const synced = await syncTopicsFromCoreForCourse(course, 'session=abc');

    expect(synced).toBe(0);
    expect(topicsCreate).not.toHaveBeenCalled();
  });

  // #315 §19: Core's API filters `deletedAt: null`, so a soft-deleted Core topic
  // never appears in the topic-pull response. QM only upserts what Core returns,
  // so the soft-deleted topic is never synced into the local table — proving
  // Core soft-deletes stay invisible to QM.
  it('never syncs a soft-deleted Core topic (absent from the Core response)', async () => {
    // Core has soft-deleted "ct-deleted"; its filtered response omits it.
    getCourseTopicsFromCore.mockResolvedValue({
      topics: [{ id: 'ct-live', name: 'Live Topic' }],
    });
    topicsFindMany.mockResolvedValue([]);

    const synced = await syncTopicsFromCoreForCourse(course, 'session=abc');

    expect(synced).toBe(1);
    // Only the surviving topic is created…
    expect(topicsCreate).toHaveBeenCalledTimes(1);
    expect(topicsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Live Topic',
        courseId: 10,
        coreTopicId: 'ct-live',
      }),
    });
    // …and the soft-deleted topic is never written locally.
    const createdCoreIds = topicsCreate.mock.calls.map(([{ data }]) => data.coreTopicId);
    expect(createdCoreIds).not.toContain('ct-deleted');
  });

  it('rethrows Core errors when failOnCoreError is set', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    getCourseTopicsFromCore.mockRejectedValue(err);

    await expect(
      syncTopicsFromCoreForCourse(course, 'session=abc', { failOnCoreError: true }),
    ).rejects.toBe(err);
  });
});
