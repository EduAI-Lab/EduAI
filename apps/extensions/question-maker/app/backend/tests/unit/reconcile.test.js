/**
 * Unit tests for the QM daily reconciliation job.
 * Mocks the Prisma client and coreApiService — no DB or live Core required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock settings so coreApiService resolves its config at import time
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'test-key' };
  return { config: cfg, default: cfg };
});

// Track model calls via shared spies
const mockCourseFindMany = vi.fn();
const mockCourseDelete = vi.fn();
const mockTopicsFindMany = vi.fn();
const mockTopicsUpdate = vi.fn();
const mockVariantsFindMany = vi.fn();
const mockVariantsUpdate = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findMany: (...a) => mockCourseFindMany(...a), delete: (...a) => mockCourseDelete(...a) },
    topics: { findMany: (...a) => mockTopicsFindMany(...a), update: (...a) => mockTopicsUpdate(...a) },
    variants: { findMany: (...a) => mockVariantsFindMany(...a), update: (...a) => mockVariantsUpdate(...a) },
  },
}));

const { runReconciliation } = await import('../../src/jobs/reconcile.js');

beforeEach(() => {
  mockCourseFindMany.mockResolvedValue([]);
  mockTopicsFindMany.mockResolvedValue([]);
  mockVariantsFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Phase 1 — courses.core_course_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Course', () => {
  it('deletes the course (cascading to its topics/questions/assessments) when Core returns 404', async () => {
    mockCourseFindMany.mockResolvedValue([{ id: 1, coreCourseId: 'core-cuid-1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'COURSE_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockCourseDelete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('does not delete when Core returns the course (200)', async () => {
    mockCourseFindMany.mockResolvedValue([{ id: 1, coreCourseId: 'core-cuid-1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));

    await runReconciliation();

    expect(mockCourseDelete).not.toHaveBeenCalled();
  });

  it('skips the row without deleting when Core returns 5xx', async () => {
    mockCourseFindMany.mockResolvedValue([{ id: 1, coreCourseId: 'core-cuid-1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'Service Unavailable' }),
    }));

    await runReconciliation();

    expect(mockCourseDelete).not.toHaveBeenCalled();
  });

  it('continues to the next row when one throws', async () => {
    mockCourseFindMany.mockResolvedValue([
      { id: 1, coreCourseId: 'core-cuid-1' },
      { id: 2, coreCourseId: 'core-cuid-2' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'COURSE_NOT_FOUND' }) }),
    );

    await runReconciliation();

    expect(mockCourseDelete).not.toHaveBeenCalledWith({ where: { id: 1 } });
    expect(mockCourseDelete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — topics.core_topic_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Topics', () => {
  it('nullifies coreTopicId when Core returns 404', async () => {
    mockTopicsFindMany.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: 'core-cuid-1' } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'TOPIC_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockTopicsUpdate).toHaveBeenCalledWith({ where: { id: 'topic-1' }, data: { coreTopicId: null } });
  });

  it('skips a topic whose course has no coreCourseId', async () => {
    const mockFetch = vi.fn();
    mockTopicsFindMany.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: null } },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await runReconciliation();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTopicsUpdate).not.toHaveBeenCalled();
  });

  it('skips the topic row without updating when Core returns 5xx', async () => {
    mockTopicsFindMany.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: 'core-cuid-1' } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }));

    await runReconciliation();

    expect(mockTopicsUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — variants.core_question_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Variants', () => {
  it('nullifies coreQuestionId when Core returns 404', async () => {
    mockVariantsFindMany.mockResolvedValue([{ id: 10, coreQuestionId: 'core-q-1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'QUESTION_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockVariantsUpdate).toHaveBeenCalledWith({ where: { id: 10 }, data: { coreQuestionId: null } });
  });

  it('skips the row without updating when Core returns 5xx', async () => {
    mockVariantsFindMany.mockResolvedValue([{ id: 10, coreQuestionId: 'core-q-1' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }));

    await runReconciliation();

    expect(mockVariantsUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Empty tables
// ---------------------------------------------------------------------------
describe('runReconciliation — empty tables', () => {
  it('completes without errors when there are no linked rows', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(runReconciliation()).resolves.toBeUndefined();
  });
});
