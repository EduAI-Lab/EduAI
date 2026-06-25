import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runReconciliation } from '../../src/jobs/reconcile.js';

const CORE_URL = 'http://core.test/api';
const SERVICE_KEY = 'test-service-key';

// Shared Prisma mock — overridden per test
const mockFindManyOfferings = vi.fn();
const mockFindManyTopics = vi.fn();
const mockUpdateOffering = vi.fn();
const mockUpdateTopic = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: {
      findMany: (...args) => mockFindManyOfferings(...args),
      update: (...args) => mockUpdateOffering(...args),
    },
    topic: {
      findMany: (...args) => mockFindManyTopics(...args),
      update: (...args) => mockUpdateTopic(...args),
    },
  },
}));

beforeEach(() => {
  process.env.EDUAI_API_KEY = SERVICE_KEY;
  process.env.EDUAI_BASE_URL = CORE_URL;
  // Default: empty tables
  mockFindManyOfferings.mockResolvedValue([]);
  mockFindManyTopics.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('runReconciliation — CourseOffering', () => {
  it('nullifies coreOfferingId when Core returns 404', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('COURSE_NOT_FOUND'),
    }));

    await runReconciliation();

    expect(mockUpdateOffering).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { coreOfferingId: null },
    });
  });

  it('does not update when Core returns the course (200)', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));

    await runReconciliation();

    expect(mockUpdateOffering).not.toHaveBeenCalled();
  });

  it('skips the row without updating when Core returns 5xx', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }));

    await runReconciliation();

    expect(mockUpdateOffering).not.toHaveBeenCalled();
  });

  it('continues to the next row when one row throws', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
      { id: 2, coreOfferingId: 'core-cuid-2' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('error') })
        .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('not found') }),
    );

    await runReconciliation();

    expect(mockUpdateOffering).toHaveBeenCalledOnce();
    expect(mockUpdateOffering).toHaveBeenCalledWith({ where: { id: 2 }, data: { coreOfferingId: null } });
  });
});

describe('runReconciliation — Topic', () => {
  it('nullifies coreTopicId when Core returns 404', async () => {
    mockFindManyTopics.mockResolvedValue([
      { id: 'topic-cuid-1', coreTopicId: 'core-topic-1', courseOffering: { coreOfferingId: 'core-cuid-1' } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('TOPIC_NOT_FOUND'),
    }));

    await runReconciliation();

    expect(mockUpdateTopic).toHaveBeenCalledWith({
      where: { id: 'topic-cuid-1' },
      data: { coreTopicId: null },
    });
  });

  it('skips a topic whose courseOffering has no coreOfferingId', async () => {
    mockFindManyTopics.mockResolvedValue([
      { id: 'topic-cuid-1', coreTopicId: 'core-topic-1', courseOffering: { coreOfferingId: null } },
    ]);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await runReconciliation();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpdateTopic).not.toHaveBeenCalled();
  });

  it('skips the topic row without updating when Core returns 5xx', async () => {
    mockFindManyTopics.mockResolvedValue([
      { id: 'topic-cuid-1', coreTopicId: 'core-topic-1', courseOffering: { coreOfferingId: 'core-cuid-1' } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }));

    await runReconciliation();

    expect(mockUpdateTopic).not.toHaveBeenCalled();
  });
});

describe('runReconciliation — empty tables', () => {
  it('completes without errors when there are no linked rows', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(runReconciliation()).resolves.toBeUndefined();
  });
});
