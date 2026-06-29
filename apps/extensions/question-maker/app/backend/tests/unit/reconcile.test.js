/**
 * Unit tests for the QM daily reconciliation job.
 * Mocks Sequelize models and coreApiService — no DB or live Core required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock settings so coreApiService resolves its config at import time
vi.mock('../../src/config/settings.js', () => {
  const cfg = { coreUrl: 'http://core.test', eduaiApiKey: 'test-key' };
  return { config: cfg, default: cfg };
});

// Track model calls via shared spies
const mockCourseFindAll = vi.fn();
const mockCourseUpdate = vi.fn();
const mockTopicsFindAll = vi.fn();
const mockTopicsUpdate = vi.fn();
const mockVariantsFindAll = vi.fn();
const mockVariantsUpdate = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Course: { findAll: (...a) => mockCourseFindAll(...a) },
  Topics: { findAll: (...a) => mockTopicsFindAll(...a) },
  Variants: { findAll: (...a) => mockVariantsFindAll(...a) },
}));

const { runReconciliation } = await import('../../src/jobs/reconcile.js');

beforeEach(() => {
  mockCourseFindAll.mockResolvedValue([]);
  mockTopicsFindAll.mockResolvedValue([]);
  mockVariantsFindAll.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Phase 1 — courses.core_course_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Course', () => {
  it('nullifies coreCourseId when Core returns 404', async () => {
    const mockUpdate = vi.fn();
    mockCourseFindAll.mockResolvedValue([
      { id: 1, coreCourseId: 'core-cuid-1', update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'COURSE_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockUpdate).toHaveBeenCalledWith({ coreCourseId: null });
  });

  it('does not update when Core returns the course (200)', async () => {
    const mockUpdate = vi.fn();
    mockCourseFindAll.mockResolvedValue([
      { id: 1, coreCourseId: 'core-cuid-1', update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));

    await runReconciliation();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips the row without updating when Core returns 5xx', async () => {
    const mockUpdate = vi.fn();
    mockCourseFindAll.mockResolvedValue([
      { id: 1, coreCourseId: 'core-cuid-1', update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'Service Unavailable' }),
    }));

    await runReconciliation();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('continues to the next row when one throws', async () => {
    const mockUpdate1 = vi.fn();
    const mockUpdate2 = vi.fn();
    mockCourseFindAll.mockResolvedValue([
      { id: 1, coreCourseId: 'core-cuid-1', update: mockUpdate1 },
      { id: 2, coreCourseId: 'core-cuid-2', update: mockUpdate2 },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'COURSE_NOT_FOUND' }) }),
    );

    await runReconciliation();

    expect(mockUpdate1).not.toHaveBeenCalled();
    expect(mockUpdate2).toHaveBeenCalledWith({ coreCourseId: null });
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — topics.core_topic_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Topics', () => {
  it('nullifies coreTopicId when Core returns 404', async () => {
    const mockUpdate = vi.fn();
    mockTopicsFindAll.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: 'core-cuid-1' }, update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'TOPIC_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockUpdate).toHaveBeenCalledWith({ coreTopicId: null });
  });

  it('skips a topic whose course has no coreCourseId', async () => {
    const mockUpdate = vi.fn();
    const mockFetch = vi.fn();
    mockTopicsFindAll.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: null }, update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    await runReconciliation();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips the topic row without updating when Core returns 5xx', async () => {
    const mockUpdate = vi.fn();
    mockTopicsFindAll.mockResolvedValue([
      { id: 'topic-1', coreTopicId: 'core-topic-1', course: { coreCourseId: 'core-cuid-1' }, update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }));

    await runReconciliation();

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — variants.core_question_id
// ---------------------------------------------------------------------------
describe('runReconciliation — Variants', () => {
  it('nullifies coreQuestionId when Core returns 404', async () => {
    const mockUpdate = vi.fn();
    mockVariantsFindAll.mockResolvedValue([
      { id: 10, coreQuestionId: 'core-q-1', update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'QUESTION_NOT_FOUND' }),
    }));

    await runReconciliation();

    expect(mockUpdate).toHaveBeenCalledWith({ coreQuestionId: null });
  });

  it('skips the row without updating when Core returns 5xx', async () => {
    const mockUpdate = vi.fn();
    mockVariantsFindAll.mockResolvedValue([
      { id: 10, coreQuestionId: 'core-q-1', update: mockUpdate },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }));

    await runReconciliation();

    expect(mockUpdate).not.toHaveBeenCalled();
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
