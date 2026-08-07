import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runReconciliation } from '../../src/jobs/reconcile.js';
import {
  syncCourseEnrollments,
  clearEnrollmentSyncThrottle,
} from '../../src/services/enrollmentSync.js';

const CORE_URL = 'http://core.test/api';
const SERVICE_KEY = 'test-service-key';

// Shared Prisma mock — overridden per test
const mockFindManyOfferings = vi.fn();
const mockFindManyTopics = vi.fn();
const mockDeleteOffering = vi.fn();
const mockUpdateTopic = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    courseOffering: {
      findMany: (...args) => mockFindManyOfferings(...args),
      delete: (...args) => mockDeleteOffering(...args),
    },
    topic: {
      findMany: (...args) => mockFindManyTopics(...args),
      update: (...args) => mockUpdateTopic(...args),
    },
  },
}));

// Phase 3 (enrollment reconciliation, #1065) delegates to `syncCourseEnrollments`,
// whose own create/update/delete/TA-handling logic is covered by
// `enrollmentSync.test.js` — here we only assert reconcile.js calls it correctly.
vi.mock('../../src/services/enrollmentSync.js', () => ({
  syncCourseEnrollments: vi.fn(),
  clearEnrollmentSyncThrottle: vi.fn(),
  AUTO_SYNC_TIMEOUT_MS: 3_000,
}));

beforeEach(() => {
  process.env.EDUAI_API_KEY = SERVICE_KEY;
  process.env.EDUAI_BASE_URL = CORE_URL;
  // Default: empty tables
  mockFindManyOfferings.mockResolvedValue([]);
  mockFindManyTopics.mockResolvedValue([]);
  vi.mocked(syncCourseEnrollments).mockReset();
  vi.mocked(syncCourseEnrollments).mockResolvedValue({
    synced: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  });
  vi.mocked(clearEnrollmentSyncThrottle).mockReset();
});

afterEach(() => {
  delete process.env.EDUAI_API_KEY;
  delete process.env.EDUAI_BASE_URL;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('runReconciliation — CourseOffering', () => {
  it('deletes the CourseOffering (cascading to modules/lessons/activities) when Core returns 404', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('COURSE_NOT_FOUND'),
    }));

    await runReconciliation();

    expect(mockDeleteOffering).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('does not delete when Core returns the course (200)', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));

    await runReconciliation();

    expect(mockDeleteOffering).not.toHaveBeenCalled();
  });

  it('skips the row without deleting when Core returns 5xx', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }));

    await runReconciliation();

    expect(mockDeleteOffering).not.toHaveBeenCalled();
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

    expect(mockDeleteOffering).toHaveBeenCalledOnce();
    expect(mockDeleteOffering).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it('evicts the enrollment sync throttle entry for a deleted CourseOffering', async () => {
    mockFindManyOfferings.mockResolvedValue([
      { id: 1, coreOfferingId: 'core-cuid-1' },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('COURSE_NOT_FOUND'),
    }));

    await runReconciliation();

    expect(clearEnrollmentSyncThrottle).toHaveBeenCalledWith(1);
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

describe('runReconciliation — CourseEnrollment (Phase 3, #1065)', () => {
  it('syncs enrollments for every remaining CourseOffering', async () => {
    const offeringA = { id: 1, coreOfferingId: 'core-cuid-1' };
    const offeringB = { id: 2, coreOfferingId: 'core-cuid-2' };
    mockFindManyOfferings.mockResolvedValue([offeringA, offeringB]);
    mockFindManyTopics.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));

    await runReconciliation();

    expect(syncCourseEnrollments).toHaveBeenCalledWith(1, expect.objectContaining({ course: offeringA }));
    expect(syncCourseEnrollments).toHaveBeenCalledWith(2, expect.objectContaining({ course: offeringB }));
  });

  it('does not sync enrollments for a CourseOffering deleted in Phase 1 (Core 404)', async () => {
    const offering = { id: 1, coreOfferingId: 'core-cuid-1' };
    mockFindManyOfferings.mockResolvedValue([offering]);
    mockFindManyTopics.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('COURSE_NOT_FOUND'),
    }));

    await runReconciliation();

    expect(mockDeleteOffering).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(syncCourseEnrollments).not.toHaveBeenCalled();
  });

  it('continues reconciling other offerings when one enrollment sync throws', async () => {
    const offeringA = { id: 1, coreOfferingId: 'core-cuid-1' };
    const offeringB = { id: 2, coreOfferingId: 'core-cuid-2' };
    mockFindManyOfferings.mockResolvedValue([offeringA, offeringB]);
    mockFindManyTopics.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'core-cuid-1', name: 'Test' }),
    }));
    vi.mocked(syncCourseEnrollments)
      .mockRejectedValueOnce(new Error('Core unavailable'))
      .mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });

    await expect(runReconciliation()).resolves.toBeUndefined();

    expect(syncCourseEnrollments).toHaveBeenCalledTimes(2);
  });
});

describe('runReconciliation — empty tables', () => {
  it('completes without errors when there are no linked rows', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(runReconciliation()).resolves.toBeUndefined();
    expect(syncCourseEnrollments).not.toHaveBeenCalled();
  });
});
